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

const repliedMap = {}; // parent_id => Set of commentIds replied

// ⏱ Helper: Track if we've already replied to a comment in the thread
function hasReplied(parentId, commentId) {
  return repliedMap[parentId]?.has(commentId) || false;
}

function registerReply(parentId, commentId) {
  if (!repliedMap[parentId]) repliedMap[parentId] = new Set();
  repliedMap[parentId].add(commentId);

  // Remove after 1 hour to prevent memory leak
  setTimeout(() => {
    repliedMap[parentId].delete(commentId);
    if (repliedMap[parentId].size === 0) delete repliedMap[parentId];
  }, 3600000); // 1 hour
}

// 🔍 Middleware to log incoming webhook
app.use((req, res, next) => {
  console.log("➡️ Webhook received:");
  console.log("Headers:", JSON.stringify(req.headers, null, 2));
  console.log("Body:", JSON.stringify(req.body, null, 2));
  next();
});

// ✅ Webhook verification
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

// 📦 Webhook handler
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
          console.log("🧷 Parent ID:", parentId);

          // ⛔ Skip own comments
          if (username === IG_USERNAME) {
            console.log("⛔ Skipping: Comment is from the page owner.");
            continue;
          }

          // ⛔ Skip if replied to this comment already or more than 2 times
          if (hasReplied(parentId, commentId)) {
            console.log("⛔ Skipping: Already replied to this comment.");
            continue;
          }
          if ((repliedMap[parentId]?.size || 0) >= 2) {
            console.log("⛔ Skipping: Reached max replies to this thread.");
            continue;
          }

          // ⛔ Skip if asking for link
          if (isAskingForLink(commentText)) {
            console.log("⛔ Skipping: User asked for a link.");
            continue;
          }

          // ✅ Generate & reply
          const reply = await generateReply(commentText, username);
          if (reply) {
            await replyToComment(commentId, reply);
            registerReply(parentId, commentId);
          }
        }
      }
    }
    return res.status(200).send("EVENT_RECEIVED");
  }

  return res.sendStatus(404);
});

// 🔗 Check if comment is asking for a link
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

// 🧠 Generate AI reply
async function generateReply(comment, username) {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4", // Best for quality. Use "gpt-4o" if latency is critical.
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
  } catch (error) {
    console.error(
      "❌ Error generating reply:",
      error.response?.data || error.message
    );
    return null;
  }
}

// 💬 Send reply to Instagram comment
async function replyToComment(commentId, message) {
  if (!message) {
    console.log("⚠️ Skipping reply: message is null.");
    return;
  }
  try {
    const url = `https://graph.facebook.com/v19.0/${commentId}/replies`;
    const response = await axios.post(url, {
      message,
      access_token: INSTAGRAM_PAGE_ACCESS_TOKEN,
    });
    console.log("✅ Replied to comment:", response.data);
  } catch (error) {
    console.error(
      "❌ Error replying to comment:",
      error.response?.data || error.message
    );
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
