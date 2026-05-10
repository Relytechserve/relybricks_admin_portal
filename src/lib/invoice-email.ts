import nodemailer from "nodemailer";

type SendInvoiceEmailInput = {
  to: string;
  subject: string;
  html: string;
  pdfFilename: string;
  pdfBuffer: Buffer;
};

function readSmtpConfig() {
  const host = (process.env.SMTP_HOST ?? "").trim();
  const user = (process.env.SMTP_USER ?? "").trim();
  const pass = (process.env.SMTP_PASS ?? "").trim();
  const from = (process.env.SMTP_FROM ?? "").trim();
  const port = Number(process.env.SMTP_PORT ?? 587);
  const secure = port === 465;
  if (!host || !user || !pass || !from) {
    throw new Error("Email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.");
  }
  return { host, user, pass, from, port, secure };
}

export async function sendInvoiceEmail(input: SendInvoiceEmailInput): Promise<string | null> {
  const cfg = readSmtpConfig();
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });

  const result = await transporter.sendMail({
    from: cfg.from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    attachments: [
      {
        filename: input.pdfFilename,
        content: input.pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });

  return result.messageId ?? null;
}
