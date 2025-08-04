const express = require("express");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const {
  OPENAI_API_KEY,
  INSTAGRAM_PAGE_ACCESS_TOKEN,
  VERIFY_TOKEN,
  IG_USERNAME,
} = process.env;

// 🧠 Track reply count per parent comment thread
const repliedCount = {}; // key: parentId, value: count

// 🔍 Log incoming requests
app.use((req, res, next) => {
  console.log("➡️ Webhook received:");
  console.log("Headers:", JSON.stringify(req.headers, null, 2));
  console.log("Body:", JSON.stringify(req.body, null, 2));
  next();
});

// ✅ Webhook Verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified!");
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

// 📦 Main Webhook Handler
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body?.object === "instagram") {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field === "comments") {
          const {
            text: commentText,
            id: commentId,
            from,
            parent_id,
          } = change.value;
          const username = from?.username;
          const parentId = parent_id || commentId;

          console.log("💬 IG Comment:", commentText);
          console.log("👤 From:", username);
          console.log("🆔 Comment ID:", commentId);
          console.log("🔗 Parent ID:", parentId);

          // 1️⃣ Skip if from own business account
          if (username === IG_USERNAME) {
            console.log("⛔ Skipped: Comment is from business account.");
            continue;
          }

          // 2️⃣ Skip if reply count ≥ 2
          repliedCount[parentId] = repliedCount[parentId] || 0;
          if (repliedCount[parentId] >= 2) {
            console.log("⛔ Skipped: Max replies already sent.");
            continue;
          }

          // 3️⃣ Skip if user asked for a link
          if (isAskingForLink(commentText)) {
            console.log("⛔ Skipped: Link-related comment.");
            continue;
          }

          // 4️⃣ Generate AI reply and respond
          const reply = await generateReply(commentText, username);
          if (reply) {
            await replyToComment(commentId, reply);
            repliedCount[parentId]++;
          }
        }
      }
    }
    return res.status(200).send("EVENT_RECEIVED");
  }

  return res.sendStatus(404);
});

// 🔎 Detect Link-Requesting Intent
function isAskingForLink(text = "") {
  const lower = text.toLowerCase();
  return (
    lower.includes("link") ||
    lower.includes("buy") ||
    lower.includes("website") ||
    lower.includes("url") ||
    lower.includes("how to order") ||
    lower.includes("how to buy") ||
    lower.includes("where can i get") ||
    (lower.includes("send") && lower.includes("link"))
  );
}

// 🤖 Generate AI Reply
async function generateReply(comment, username) {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content:
              "You are a friendly assistant helping users on an Instagram store. Keep replies short and helpful.",
          },
          {
            role: "user",
            content: `User @${username} commented: "${comment}"`,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY.trim()}`,
          "Content-Type": "application/json",
        },
      }
    );
    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error(
      "❌ Error generating reply:",
      error.response?.data || error.message
    );
    return null;
  }
}

// 💬 Send Reply to Instagram Comment
async function replyToComment(commentId, message) {
  if (!message) {
    console.log("⚠️ Skipped: No reply generated.");
    return;
  }
  try {
    const url = `https://graph.facebook.com/v19.0/${commentId}/replies`;
    const res = await axios.post(url, {
      message,
      access_token: INSTAGRAM_PAGE_ACCESS_TOKEN,
    });
    console.log("✅ Replied to comment:", res.data);
  } catch (error) {
    console.error("❌ Error replying:", error.response?.data || error.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
