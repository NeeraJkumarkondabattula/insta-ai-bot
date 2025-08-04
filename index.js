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

// Track number of replies per parent comment thread
const replyTracker = {}; // parent_id => Set<commentId>

// Verify webhook
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

// Handle webhook event
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body?.object === "instagram") {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field === "comments") {
          const { text, id: commentId, parent_id, from } = change.value;
          const username = from?.username;
          const parentId = parent_id || commentId;

          console.log("💬 IG Comment:", text);
          console.log("👤 From:", username);
          console.log("🧷 Parent ID:", parentId);

          if (username === IG_USERNAME) {
            console.log("⛔ Skipping own comment.");
            continue;
          }

          if (isAskingForLink(text)) {
            console.log("⛔ Skipping link-related comment.");
            continue;
          }

          // Initialize thread tracking
          if (!replyTracker[parentId]) replyTracker[parentId] = new Set();

          if (replyTracker[parentId].size >= 2) {
            console.log("⛔ Max replies reached for this thread.");
            continue;
          }

          if (replyTracker[parentId].has(commentId)) {
            console.log("⛔ Already replied to this comment.");
            continue;
          }

          const reply = await generateReply(text, username);
          if (reply) {
            await replyToComment(commentId, reply);
            replyTracker[parentId].add(commentId);
          }
        }
      }
    }
    return res.status(200).send("EVENT_RECEIVED");
  }

  return res.sendStatus(404);
});

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
              "You are a helpful and friendly Instagram assistant. Keep responses short and positive.",
          },
          {
            role: "user",
            content: `Instagram user ${username} commented: "${comment}"`,
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
  } catch (err) {
    console.error("❌ OpenAI error:", err.response?.data || err.message);
    return null;
  }
}

async function replyToComment(commentId, message) {
  if (!message) return;
  try {
    const url = `https://graph.facebook.com/v19.0/${commentId}/replies`;
    const response = await axios.post(url, {
      message,
      access_token: INSTAGRAM_PAGE_ACCESS_TOKEN,
    });
    console.log("✅ Replied to comment:", response.data);
  } catch (err) {
    console.error("❌ Error replying:", err.response?.data || err.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
