import express from 'express'
import cors from 'cors'

const app = express()

app.use(cors())
app.use(express.json({ limit: '50mb' }))

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'healthwallet-ocr-api' })
})

app.post('/analyze-exam', async (req, res) => {
  try {
    const { fileUrl, fileName, profile } = req.body || {}

    if (!fileUrl) {
      return res.json(fallback('Arquivo sem URL informada.'))
    }

    const apiKey = process.env.OPENAI_API_KEY

    if (!apiKey) {
      return res.json(fallback('OPENAI_API_KEY não configurada no Render.'))
    }

    const fileRes = await fetch(fileUrl)

    if (!fileRes.ok) {
      return res.json(fallback('Não foi possível baixar o arquivo do Supabase Storage.'))
    }

    const contentType = fileRes.headers.get('content-type') || 'application/pdf'
    const arrayBuffer = await fileRes.arrayBuffer()

    const form = new FormData()
    form.append('purpose', 'user_data')
    form.append(
      'file',
      new Blob([arrayBuffer], { type: contentType }),
      fileName || 'exame.pdf'
    )

    const uploadRes = await fetch('https://api.openai.com/v1/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: form
    })

    const uploadJson = await uploadRes.json()

    if (!uploadRes.ok || !uploadJson.id) {
      return res.json(
        fallback(uploadJson.error?.message || 'Erro ao enviar arquivo para OpenAI.')
      )
    }

    const prompt = `
Você é um médico explicador e especialista em exames laboratoriais brasileiros.

Analise o exame enviado e gere uma interpretação útil, clara e personalizada.

Use também o contexto do paciente:
${JSON.stringify(profile || {}, null, 2)}

Objetivo:
Não apenas extrair valores. Explique o que o exame mostra, o que está bom, o que merece atenção, quais riscos podem estar relacionados e quais próximos passos fazem sentido.

Regras:
- Não dê diagnóstico definitivo.
- Não substitua consulta médica.
- Não assuste o paciente.
- Seja claro e prático.
- Se houver colesterol/LDL alto, explique risco cardiovascular.
- Se glicemia estiver alterada, explique risco metabólico.
- Se creatinina/TFG vier alterada, explique função renal.
- Se TGO/TGP vier alterado, explique fígado.
- Se TSH vier alterado, explique tireoide.
- Se hemograma vier alterado, explique anemia/infecção/plaquetas conforme o marcador.
- Se houver marcadores normais importantes, destaque também.

Responda SOMENTE JSON válido:
{
  "summary": "análise integrada do exame em linguagem simples, mencionando principais achados, pontos bons e pontos de atenção",
  "clinicalSummary": "resumo mais técnico para profissional de saúde",
  "mainAlerts": ["principal alerta 1", "principal alerta 2"],
  "goodNews": ["ponto positivo 1", "ponto positivo 2"],
  "riskAreas": ["cardiovascular", "metabólico", "renal", "hepático", "tireoide", "hematológico"],
  "examType": "tipo do exame",
  "examDate": null,
  "laboratory": null,
  "patientName": null,
  "confidence": 0.8,
  "items": [
    {
      "name": "nome do marcador",
      "value": "valor",
      "unit": "unidade",
      "reference": "referência",
      "status": "normal|alto|baixo|atencao",
      "explanation": "explicação simples para paciente",
      "context": "por que esse marcador importa"
    }
  ],
  "nextSteps": [
    "ação prática 1",
    "ação prática 2",
    "ação prática 3"
  ],
  "questionsForDoctor": [
    "pergunta útil para levar ao médico"
  ],
  "lifestyleSuggestions": [
    "sugestão de hábito baseada no exame"
  ],
  "extractedText": "texto relevante extraído"
}
`
`

    const openaiRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              { type: 'input_file', file_id: uploadJson.id }
            ]
          }
        ]
      })
    })

    const json = await openaiRes.json()

    if (!openaiRes.ok) {
      return res.json(
        fallback(json.error?.message || 'Erro ao analisar arquivo na OpenAI.')
      )
    }

    const text =
      json.output_text ||
      json.output?.[0]?.content?.[0]?.text ||
      ''

    let parsed

    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = fallback(text || 'IA não retornou JSON válido.')
    }

    return res.json({
  summary: parsed.summary || 'Exame analisado.',
  clinicalSummary: parsed.clinicalSummary || '',
  mainAlerts: Array.isArray(parsed.mainAlerts) ? parsed.mainAlerts : [],
  goodNews: Array.isArray(parsed.goodNews) ? parsed.goodNews : [],
  riskAreas: Array.isArray(parsed.riskAreas) ? parsed.riskAreas : [],
  examType: parsed.examType || 'Exame',
  examDate: parsed.examDate || null,
  laboratory: parsed.laboratory || null,
  patientName: parsed.patientName || null,
  confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
  items: Array.isArray(parsed.items) ? parsed.items : [],
  nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [],
  questionsForDoctor: Array.isArray(parsed.questionsForDoctor) ? parsed.questionsForDoctor : [],
  lifestyleSuggestions: Array.isArray(parsed.lifestyleSuggestions) ? parsed.lifestyleSuggestions : [],
  extractedText: parsed.extractedText || '',
  error: parsed.error || null
})
  } catch (error) {
    return res.json(fallback(error.message || 'Erro inesperado.'))
  }
})

function fallback(reason) {
  return {
    summary:
      'Exame recebido com sucesso, mas a análise automática não conseguiu interpretar o arquivo.',
    examType: null,
    examDate: null,
    laboratory: null,
    patientName: null,
    confidence: 0,
    items: [],
    nextSteps: [
      'Tente enviar PDF pesquisável ou imagem/foto nítida.',
      'Leve o exame para avaliação de um profissional de saúde.'
    ],
    extractedText: reason,
    error: reason
  }
}

const port = process.env.PORT || 3000

app.listen(port, () => {
  console.log(`HealthWallet OCR API running on port ${port}`)
})
