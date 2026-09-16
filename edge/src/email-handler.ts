/**
 * Cloudflare Email Routing & Agentic Inbox Handler
 * Inbound processor acionado por ForwardableEmailMessage.
 */

import PostalMime from 'postal-mime';

export interface EmailEnv {
  DB: D1Database;
  MEDIA: R2Bucket;
  AI: any;
  EMAIL?: SendEmail;
  NOTIFY_QUEUE?: Queue<any>;
  BACKEND_ORIGIN?: string;
  BACKEND_SERVICE_TOKEN?: string;
}

export type EmailAttachmentMeta = {
  filename: string;
  mimeType: string;
  size: number;
  r2Key: string;
};

export type AnalysisResult = {
  intent: 'duvida_matricula' | 'envio_documentos' | 'comprovante_pagamento' | 'suporte' | 'spam' | 'outro';
  confidence: number;
  summary: string;
  extracted_entities: {
    cpf?: string | null;
    phone?: string | null;
    student_name?: string | null;
  };
  suggested_reply?: string;
};

/**
 * Analisa o conteúdo do email usando Cloudflare Workers AI
 */
export async function analyzeEmailWithAI(
  ai: any,
  subject: string,
  bodyText: string
): Promise<AnalysisResult> {
  if (!ai) {
    return {
      intent: 'outro',
      confidence: 0.5,
      summary: subject,
      extracted_entities: {},
    };
  }

  const prompt = `Você é o triador de IA oficial da plataforma educacional Supletivo.net.br.
Analise o email abaixo recebido de um aluno ou interessado.
Classifique a intenção principal estritamente em uma destas opções:
["duvida_matricula", "envio_documentos", "comprovante_pagamento", "suporte", "spam", "outro"].

Extraia também:
- CPF do aluno (se presente, formatado ou apenas dígitos)
- Telefone / WhatsApp de contato
- Nome do aluno
- Um breve resumo de 1 linha
- Uma sugestão educada e prestativa de resposta inicial em português do Brasil.

Assunto: ${subject}
Corpo da mensagem:
${bodyText.slice(0, 2000)}

Responda OBRIGATORIAMENTE em formato JSON válido com o seguinte formato exato:
{
  "intent": "duvida_matricula",
  "confidence": 0.95,
  "summary": "Dúvida sobre prazo de conclusão do supletivo",
  "extracted_entities": {
    "cpf": null,
    "phone": null,
    "student_name": null
  },
  "suggested_reply": "Olá! Obrigado por entrar em contato..."
}`;

  try {
    const response: any = await ai.run('@cf/meta/llama-3-8b-instruct', {
      prompt,
      max_tokens: 500,
    });

    const rawText = response?.response || '';
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as AnalysisResult;
    }
  } catch (err) {
    console.error('Falha ao processar com Workers AI:', err);
  }

  return {
    intent: 'outro',
    confidence: 0.5,
    summary: subject || 'Sem assunto',
    extracted_entities: {},
  };
}

/**
 * Handler principal para Cloudflare Email Routing
 */
export async function handleIncomingEmail(
  message: ForwardableEmailMessage,
  env: EmailEnv,
  ctx: ExecutionContext
): Promise<void> {
  const emailId = crypto.randomUUID();
  const fromAddress = message.from;
  const toAddress = message.to;

  // 1. Ler o stream MIME bruto (leitura única)
  const rawArrayBuffer = await new Response(message.raw).arrayBuffer();

  // 2. Parsear MIME usando postal-mime
  let parsedEmail: any;
  try {
    const parser = new PostalMime();
    parsedEmail = await parser.parse(rawArrayBuffer);
  } catch (parseError) {
    console.error('Erro ao decodificar MIME do email:', parseError);
    parsedEmail = {
      subject: message.headers.get('subject') || 'Sem assunto',
      from: { address: fromAddress, name: '' },
      text: 'Não foi possível decodificar o conteúdo da mensagem.',
      html: '',
      attachments: [],
    };
  }

  const subject = parsedEmail.subject || message.headers.get('subject') || '(Sem assunto)';
  const bodyText = parsedEmail.text || '';
  const bodyHtml = parsedEmail.html || '';
  const fromName = parsedEmail.from?.name || '';

  // 3. Processar e salvar anexos no R2 com chave isolada por email
  const attachmentsMeta: EmailAttachmentMeta[] = [];
  if (env.MEDIA && parsedEmail.attachments && parsedEmail.attachments.length > 0) {
    for (const att of parsedEmail.attachments) {
      try {
        const safeFilename = (att.filename || 'anexo').replace(/[^a-zA-Z0-9._-]/g, '_');
        const r2Key = `inbox/${emailId}/${safeFilename}`;
        await env.MEDIA.put(r2Key, att.content, {
          httpMetadata: {
            contentType: att.mimeType || 'application/octet-stream',
          },
          customMetadata: {
            emailId,
            fromAddress,
            originalName: att.filename || '',
          },
        });

        attachmentsMeta.push({
          filename: att.filename || 'anexo',
          mimeType: att.mimeType || 'application/octet-stream',
          size: att.content?.byteLength || 0,
          r2Key,
        });
      } catch (r2Err) {
        console.error('Erro ao gravar anexo no R2:', r2Err);
      }
    }
  }

  // 4. Executar Análise Inteligente via Workers AI
  const analysis = await analyzeEmailWithAI(env.AI, subject, bodyText);

  // 5. Determinar Conta / Tenant (slug padrão 'supletivo' ou extraído do domínio)
  const accountSlug = 'supletivo';

  // 6. Persistir Thread e Inbound Email no D1
  if (env.DB) {
    try {
      const threadId = crypto.randomUUID();
      
      // Upsert ou vinculação de Thread
      const existingThread: any = await env.DB.prepare(
        'SELECT id FROM email_threads WHERE peer_address = ? AND account_slug = ? ORDER BY last_message_at DESC LIMIT 1'
      )
        .bind(fromAddress, accountSlug)
        .first();

      const activeThreadId = existingThread?.id || threadId;

      if (!existingThread) {
        await env.DB.prepare(
          `INSERT INTO email_threads (id, account_slug, peer_address, subject, context_summary)
           VALUES (?, ?, ?, ?, ?)`
        )
          .bind(activeThreadId, accountSlug, fromAddress, subject, analysis.summary)
          .run();
      } else {
        await env.DB.prepare(
          `UPDATE email_threads SET last_message_at = CURRENT_TIMESTAMP, subject = ?, context_summary = ? WHERE id = ?`
        )
          .bind(subject, analysis.summary, activeThreadId)
          .run();
      }

      await env.DB.prepare(
        `INSERT INTO inbound_emails 
         (id, thread_id, account_slug, from_address, from_name, to_address, subject, text_content, html_content, intent, confidence, extracted_entities_json, r2_attachments_json, reply_draft)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          emailId,
          activeThreadId,
          accountSlug,
          fromAddress,
          fromName,
          toAddress,
          subject,
          bodyText,
          bodyHtml,
          analysis.intent,
          analysis.confidence,
          JSON.stringify(analysis.extracted_entities),
          JSON.stringify(attachmentsMeta),
          analysis.suggested_reply || null
        )
        .run();
    } catch (d1Err) {
      console.error('Erro ao persistir email no D1:', d1Err);
    }
  }

  // 7. Enfileirar evento para o Backend / WhatsApp Notifier (caso configurado)
  if (env.NOTIFY_QUEUE) {
    try {
      await env.NOTIFY_QUEUE.send({
        notification_id: emailId,
        account_slug: accountSlug,
        channel: 'email_inbound',
        recipient: toAddress,
        subject,
        payload: {
          from_address: fromAddress,
          from_name: fromName,
          intent: analysis.intent,
          summary: analysis.summary,
          extracted_entities: analysis.extracted_entities,
          attachments: attachmentsMeta,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (queueErr) {
      console.error('Erro ao enfileirar evento de inbound email:', queueErr);
    }
  }
}
