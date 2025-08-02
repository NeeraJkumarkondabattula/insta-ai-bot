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

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Webhook callback
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object === "instagram") {
    const entry = body.entry[0];
    const changes = entry.changes[0];

    if (changes.field === "comments") {
      const commentText = changes.value.message;
      const commentId = changes.value.comment_id;
      console.log(`New comment: ${commentText}`);

      // Get AI-generated reply
      const aiReply = await generateReply(commentText);

      // Send reply to Instagram
      await replyToComment(commentId, aiReply);
    }

    res.sendStatus(200);
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
