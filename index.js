const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

const { OPENAI_API_KEY, INSTAGRAM_PAGE_ACCESS_TOKEN, VERIFY_TOKEN } =
  process.env;

// For webhook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    console.log("Webhook verified!");
    res.status(200).send(challenge); // <-- Important!
  } else {
    res.sendStatus(403);
  }
});

// Webhook callback
app.post("/webhook", (req, res) => {
  const body = req.body;

  if (body.object === "page") {
    body.entry.forEach((entry) => {
      entry.changes.forEach((change) => {
        if (change.field === "feed" && change.value.item === "comment") {
          const comment = change.value.message;
          const userId = change.value.sender_id;
          const commentId = change.value.comment_id;

          console.log("💬 New Comment:", comment);
          console.log("👤 From User ID:", userId);
          console.log("🆔 Comment ID:", commentId);

          // ➤ Now you can trigger referral logic or store this in DB
        }
      });
    });

    res.status(200).send("EVENT_RECEIVED");
  } else {
    res.sendStatus(404);
  }
});

// Function: Use OpenAI to generate a reply
async function generateReply(comment) {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content:
              "You are a helpful customer support assistant for an Instagram page.",
          },
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
    console.error("Error generating reply:", error.message);
    return "Thanks for your comment!";
  }
}

// Function: Reply to a comment
async function replyToComment(commentId, message) {
  try {
    await axios.post(`https://graph.facebook.com/v19.0/${commentId}/replies`, {
      message: message,
      access_token: INSTAGRAM_PAGE_ACCESS_TOKEN,
    });

    console.log("Replied to comment");
  } catch (error) {
    console.error("Error replying to comment:", error.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
