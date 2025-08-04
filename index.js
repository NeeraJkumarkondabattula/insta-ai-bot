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

const replyTracker = {}; // parentCommentId -> Set of commentIds AI replied to

// 🔗 Check if user is asking for a link
function isAskingForLink(text) {
  const lower = text.toLowerCase();
  return (
    lower.includes("link") ||
    lower.includes("buy") ||
    lower.includes("website") ||
    lower.includes("url") ||
    lower.includes("how to buy") ||
    lower.includes("where can i get") ||
    (lower.includes("send") && lower.includes("link"))
  );
}

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

// 📦 Handle webhook POST
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body?.object === "instagram") {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field === "comments") {
          const value = change.value;
          const commentText = value.text;
          const commentId = value.id;
          const username = value.from?.username;
          const parentId = value.parent_id || value.id;

          console.log("💬 Comment:", commentText);
          console.log("👤 From:", username);
          console.log("🧷 Parent ID:", parentId);
          console.log("🆔 Comment ID:", commentId);

          // ⛔ 1. Skip if comment is from our own page
          if (username === IG_USERNAME) {
            console.log("⛔ Skipping: Comment is from page owner.");
            continue;
          }

          // ⛔ 2. Skip if asking for link
          if (isAskingForLink(commentText)) {
            console.log("⛔ Skipping: Comment is a link request.");
            continue;
          }

          // Initialize tracker for this parent
          if (!replyTracker[parentId]) replyTracker[parentId] = new Set();

          // ⛔ 3. Skip if we've already replied to this specific comment
          if (replyTracker[parentId].has(commentId)) {
            console.log("⛔ Skipping: Already replied to this comment.");
            continue;
          }

          // ⛔ 4. Skip if AI already replied 2 times in this thread
          if (replyTracker[parentId].size >= 2) {
            console.log("⛔ Skipping: Max 2 replies reached for thread.");
            continue;
          }

          // ✅ 5. Generate and send reply
          const reply = await generateReply(commentText, username);
          if (reply) {
            await replyToComment(commentId, reply);
            replyTracker[parentId].add(commentId); // track that we replied
          }
        }
      }
    }
    return res.status(200).send("EVENT_RECEIVED");
  }

  return res.sendStatus(404);
});

// 🧠 Generate AI reply
async function generateReply(comment, username) {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o", // Change to gpt-4 or gpt-4.5 if needed
        messages: [
          {
            role: "system",
            content:
              "You are a helpful and friendly assistant for an Instagram brand. Keep replies polite, short, and professional.",
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

// 💬 Reply to comment
async function replyToComment(commentId, message) {
  if (!message) return;

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
