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

const repliedCount = {}; // commentId: count

// Log middleware
app.use((req, res, next) => {
  console.log("➡️ Webhook received:");
  console.log("Headers:", JSON.stringify(req.headers, null, 2));
  console.log("Body:", JSON.stringify(req.body, null, 2));
  next();
});

// Webhook verification
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

// Webhook handler
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body?.object === "instagram") {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field === "comments") {
          const commentText = change.value.text;
          const commentId = change.value.id;
          const username = change.value.from?.username;
          const parentId = change.value.parent_id || change.value.id;

          console.log("💬 IG Comment:", commentText);
          console.log("👤 From:", username);
          console.log("🆔 Comment ID:", commentId);

          // ✅ Rule 1: Don't reply to own comments
          if (username === IG_USERNAME) {
            console.log("⛔ Skipping: Comment is from the page owner.");
            continue;
          }

          // ✅ Rule 2: Only reply twice per comment thread
          if (!repliedCount[parentId]) repliedCount[parentId] = 0;
          if (repliedCount[parentId] >= 2) {
            console.log(
              "⛔ Skipping: Reached max reply count for this comment."
            );
            continue;
          }

          // ✅ Rule 3: Check if user is asking for a link
          if (isAskingForLink(commentText)) {
            console.log("⛔ Skipping: User asked for a link.");
            continue;
          }

          // ✅ Generate and send reply
          const reply = await generateReply(commentText, username);
          await replyToComment(commentId, reply);
          repliedCount[parentId]++;
        }
      }
    }
    return res.status(200).send("EVENT_RECEIVED");
  }

  return res.sendStatus(404);
});

// Detect if the comment is a link request
function isAskingForLink(text) {
  const lower = text.toLowerCase();
  return (
    lower.includes("link") ||
    lower.includes("buy") ||
    lower.includes("website") ||
    lower.includes("url") ||
    lower.includes("where can i get") ||
    lower.includes("how to buy") ||
    (lower.includes("send") && lower.includes("link"))
  );
}

// Generate AI reply
async function generateReply(comment, username) {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4", // GPT-4.1 in practice for OpenAI API
        messages: [
          {
            role: "system",
            content:
              "You are a helpful and friendly Instagram assistant. Keep responses short, positive, and professional.",
          },
          {
            role: "user",
            content: `Instagram user ${username} commented: "${comment}"`,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
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
    return "Thanks for your comment!";
  }
}

// Reply to the comment
async function replyToComment(commentId, message) {
  try {
    const url = `https://graph.facebook.com/v19.0/${commentId}/replies`;
    const res = await axios.post(url, {
      message,
      access_token: INSTAGRAM_PAGE_ACCESS_TOKEN,
    });
    console.log("✅ Replied to comment:", res.data);
  } catch (error) {
    console.error(
      "❌ Error replying to comment:",
      error.response?.data || error.message
    );
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
