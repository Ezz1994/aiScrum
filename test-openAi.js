require("dotenv").config();
const axios = require("axios");

(async () => {
  const reply = await axios.post("https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: "Say Hi!" }]
    },
    { headers: { Authorization: `Bearer ${process.env.OPENAI_KEY}` } });

  console.log("Robot says:", reply.data.choices[0].message.content);
})();
