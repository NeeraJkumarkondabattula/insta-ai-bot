const express = require("express");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 🔍 Log incoming webhook data
app.use((req, res, next) => {
  console.log("➡️ Webhook received:");
  console.log("Headers:", JSON.stringify(req.headers, null, 2));
  console.log("Body:", JSON.stringify(req.body, null, 2));
  next();
});

const { OPENAI_API_KEY, INSTAGRAM_PAGE_ACCESS_TOKEN, VERIFY_TOKEN } =
  process.env;

// ✅ Webhook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ✅ Main webhook handler
app.post("/webhook", async (req, res) => {
  const body = req.body;

  // 📘 Facebook Page Comments
  if (body?.object === "page") {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        // 💬 FB comment on feed
        if (change.field === "feed" && change.value.item === "comment") {
          const comment = change.value.message;
          const userId = change.value.sender_id;
          const commentId = change.value.comment_id;

          console.log("💬 FB Comment:", comment);
          console.log("👤 User ID:", userId);
          console.log("🆔 Comment ID:", commentId);

          const reply = await generateReply(comment);
          await replyToComment(commentId, reply);
        }

        // 💬 IG DM (via messages field)
        if (change.field === "messages" && change.value?.message) {
          const messageText = change.value.message.text;
          const senderId = change.value.message.from.id;

          console.log("📩 IG DM:", messageText);
          console.log("👤 From IG User ID:", senderId);

          const reply = await generateReply(messageText);
          await replyToDm(senderId, reply);
        }
      }
    }
    return res.status(200).send("EVENT_RECEIVED");
  }

  // 📷 Instagram Media Comments
  if (body?.object === "instagram") {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field === "media" && change.value?.comment_id) {
          const commentText = change.value.text;
          const commentId = change.value.comment_id;
          const mediaId = change.value.media_id;
          const username = change.value.username;

          console.log("💬 IG Comment:", commentText);
          console.log("👤 From:", username);
          console.log("📸 Media ID:", mediaId);

          const reply = await generateReply(commentText);
          await replyToComment(commentId, reply);
        }
      }
    }
    return res.status(200).send("EVENT_RECEIVED");
  }

  // ❌ Unknown source
  return res.sendStatus(404);
});

// 🧠 AI-generated reply
async function generateReply(comment) {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are a helpful Instagram assistant." },
          { role: "user", content: comment },
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
    console.error("❌ Error generating reply:", error.message);
    return "Thanks for your message!";
  }
}

// 💬 Reply to IG or FB Comment
async function replyToComment(commentId, message) {
  try {
    await axios.post(`https://graph.facebook.com/v19.0/${commentId}/replies`, {
      message,
      access_token: INSTAGRAM_PAGE_ACCESS_TOKEN,
    });
    console.log("✅ Replied to comment");
  } catch (error) {
    console.error("❌ Error replying to comment:", error.message);
  }
}

// 📩 Reply to IG Direct Message (DM)
async function replyToDm(recipientId, message) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/me/messages`,
      {
        recipient: { id: recipientId },
        message: { text: message },
        messaging_type: "RESPONSE",
      },
      {
        headers: {
          Authorization: `Bearer ${INSTAGRAM_PAGE_ACCESS_TOKEN}`,
        },
      }
    );
    console.log("✅ Replied to DM");
  } catch (error) {
    console.error("❌ Error replying to DM:", error.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
