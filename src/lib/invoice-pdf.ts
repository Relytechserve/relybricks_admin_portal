import PDFDocument from "pdfkit";

export type InvoicePdfLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type InvoicePdfPayload = {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  status: string;
  customerName: string;
  customerEmail?: string | null;
  paymentTermsDays: number;
  notes?: string | null;
  subtotal: number;
  grandTotal: number;
  lineItems: InvoicePdfLineItem[];
};

function money(value: number): string {
  return value.toFixed(2);
}

export async function buildInvoicePdf(payload: InvoicePdfPayload): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text("Tax Invoice", { align: "right" });
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Invoice: ${payload.invoiceNumber}`, { align: "right" });
    doc.text(`Date: ${payload.invoiceDate}`, { align: "right" });
    doc.text(`Due: ${payload.dueDate}`, { align: "right" });
    doc.text(`Status: ${payload.status}`, { align: "right" });

    doc.moveDown(1.5);
    doc.fontSize(14).text("RelyBricks");
    doc.fontSize(10).fillColor("#444").text("Invoice generated from reconciliation transactions");
    doc.fillColor("#000");

    doc.moveDown(1.2);
    doc.fontSize(12).text("Bill To");
    doc.fontSize(10).text(payload.customerName);
    if (payload.customerEmail) doc.text(payload.customerEmail);
    doc.text(`Terms: Net ${payload.paymentTermsDays}`);

    doc.moveDown(1.2);
    doc.fontSize(11).text("Line Items");
    doc.moveDown(0.4);

    const startX = doc.x;
    const colDesc = startX;
    const colQty = 340;
    const colUnit = 400;
    const colTotal = 480;

    doc.fontSize(9).fillColor("#555");
    doc.text("Description", colDesc, doc.y);
    doc.text("Qty", colQty, doc.y - 10);
    doc.text("Unit", colUnit, doc.y - 10);
    doc.text("Total", colTotal, doc.y - 10);
    doc.moveDown(0.8);
    doc.fillColor("#000");

    for (const item of payload.lineItems) {
      const y = doc.y;
      doc.fontSize(9).text(item.description || "-", colDesc, y, { width: 300 });
      doc.text(String(item.quantity), colQty, y);
      doc.text(money(item.unitPrice), colUnit, y);
      doc.text(money(item.lineTotal), colTotal, y);
      doc.moveDown(1.4);
      if (doc.y > 730) doc.addPage();
    }

    doc.moveDown(0.8);
    doc.fontSize(10).text(`Subtotal: ${money(payload.subtotal)}`, { align: "right" });
    doc.fontSize(12).text(`Grand Total: ${money(payload.grandTotal)}`, { align: "right" });

    if (payload.notes) {
      doc.moveDown(1);
      doc.fontSize(10).text("Notes");
      doc.fontSize(9).fillColor("#333").text(payload.notes);
      doc.fillColor("#000");
    }

    doc.end();
  });
}
