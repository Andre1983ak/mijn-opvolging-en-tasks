// api/webhook.js
// Vercel serverless function - ontvangt berichten van Power Automate

export default async function handler(req, res) {
  // Sta alleen POST requests toe
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { type, content, afzender, onderwerp, context } = req.body;

    // Stuur de data door naar de Claude API voor analyse
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: `Je bent een persoonlijke assistent die berichten analyseert en taken inplant.

Vandaag is: ${new Date().toISOString().split("T")[0]}
Bron: ${type}
${context ? `Context: ${context}` : ""}
${afzender ? `Afzender: ${afzender}` : ""}
${onderwerp ? `Onderwerp: ${onderwerp}` : ""}

Bericht:
${content}

Geef een JSON-object (ALLEEN JSON, geen uitleg) met:
{
  "afzender": "naam of afdeling",
  "onderwerp": "kort onderwerp max 60 tekens",
  "samenvatting": "wat staat er in dit bericht, max 120 tekens",
  "prioriteit": "urgent|hoog|middel|laag",
  "actie_vereist": "welke concrete actie moet ondernomen worden, max 100 tekens",
  "deadline_suggestie": "ISO datum YYYY-MM-DD wanneer dit afgehandeld moet zijn",
  "deadline_reden": "waarom deze datum, max 60 tekens",
  "concept_antwoord": "professioneel concept-antwoord in het Nederlands"
}`
        }]
      })
    });

    const data = await anthropicRes.json();
    if (data.error) throw new Error(data.error.message);

    const text = data.content.map(b => b.text || "").join("");
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    const item = {
      id: Date.now(),
      bron: type || "email",
      ...parsed,
      status: "open",
      aangemaakt: new Date().toISOString(),
      origineel: content,
      geschiedenis: [],
    };

    return res.status(200).json({ success: true, item });

  } catch (error) {
    console.error("Webhook error:", error);
    return res.status(500).json({ error: error.message });
  }
}