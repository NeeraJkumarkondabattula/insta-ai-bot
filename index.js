const express = require("express");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const { OPENAI_API_KEY, INSTAGRAM_PAGE_ACCESS_TOKEN, VERIFY_TOKEN } =
  process.env;

// 🔍 Middleware to log all incoming webhook data
app.use((req, res, next) => {
  console.log("➡️ Webhook received:");
  console.log("Headers:", JSON.stringify(req.headers, null, 2));
  console.log("Body:", JSON.stringify(req.body, null, 2));
  next();
});

// ✅ Webhook verification (GET)
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

// ✅ Webhook handler (POST)
app.post("/webhook", async (req, res) => {
  const body = req.body;

  // 📘 Instagram Comments
  if (body?.object === "instagram") {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field === "comments") {
          const commentText = change.value.text;
          const commentId = change.value.id;
          const username = change.value.from?.username;

          console.log("💬 IG Comment:", commentText);
          console.log("👤 From:", username);
          console.log("🆔 Comment ID:", commentId);

          // 🧠 Generate AI reply and respond
          const reply = await generateReply(commentText, username);
          await replyToComment(commentId, reply);
        }
      }
    }
    return res.status(200).send("EVENT_RECEIVED");
  }

  return res.sendStatus(404);
});

// 🧠 Generate AI reply using OpenAI
async function generateReply(comment, username) {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content:
              "You are a friendly Instagram shop assistant. Respond politely and helpfully.",
          },
          {
            role: "user",
            content: `User ${username} commented: "${comment}"`,
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

// 💬 Reply to the comment
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
