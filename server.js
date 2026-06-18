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
Você é um especialista em exames laboratoriais brasileiros.

Analise o arquivo do exame enviado.

Extraia TODOS os dados possíveis:
- tipo do exame
- data do exame
- laboratório
- paciente, se visível
- todos os marcadores
- valor
- unidade
- referência
- status: normal, alto, baixo ou atencao
- explicação simples
- contexto clínico
- próximos passos

Use também o contexto do paciente, se disponível:
${JSON.stringify(profile || {}, null, 2)}

Responda SOMENTE JSON válido:
{
  "summary": "resumo claro para paciente",
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
      "explanation": "explicação simples",
      "context": "contexto clínico sem diagnóstico"
    }
  ],
  "nextSteps": ["orientação 1", "orientação 2"],
  "extractedText": "texto relevante extraído"
}

Não dê diagnóstico.
Não substitua consulta médica.
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
      examType: parsed.examType || 'Exame',
      examDate: parsed.examDate || null,
      laboratory: parsed.laboratory || null,
      patientName: parsed.patientName || null,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
      items: Array.isArray(parsed.items) ? parsed.items : [],
      nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [],
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
