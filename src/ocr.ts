export interface ExtractedInvoice {
  vendor?: string;
  date?: string;
  total?: number;
  suggestedCategory?: string;
  rawText?: string;
}

const categoryKeywords: Record<string, string[]> = {
  Comida: [
    'restaurante',
    'comida',
    'cena',
    'almuerzo',
    'desayuno',
    'cafe',
    'cafetería',
    'supermercado',
    'abarrotes',
    'mercado',
  ],
  Transporte: [
    'gasolina',
    'combustible',
    'taxi',
    'uber',
    'metro',
    'bus',
    'transporte',
    'estacionamiento',
    'peaje',
  ],
  Vivienda: [
    'alquiler',
    'renta',
    'hipoteca',
    'inmueble',
    'ferretería',
    'hogar',
  ],
  Servicios: [
    'luz',
    'energía',
    'agua',
    'gas',
    'internet',
    'telefono',
    'telefonía',
    'electricidad',
    'servicio',
  ],
  Salud: [
    'farmacia',
    'botica',
    'clinica',
    'clínica',
    'hospital',
    'medico',
    'médico',
    'doctor',
    'salud',
  ],
  Educación: [
    'colegio',
    'universidad',
    'escuela',
    'educacion',
    'educación',
    'curso',
    'libreria',
    'librería',
  ],
  Entretenimiento: [
    'cine',
    'teatro',
    'bar',
    'discoteca',
    'entretenimiento',
    'juego',
    'streaming',
    'netflix',
    'spotify',
  ],
  Ropa: [
    'ropa',
    'moda',
    'textil',
    'zapatos',
    'calzado',
  ],
  Impuestos: [
    'impuesto',
    'iva',
    'sat',
    'tributo',
    'municipal',
    'predial',
  ],
};

export async function extractInvoiceFromFile(
  file: File
): Promise<ExtractedInvoice> {
  const { default: Tesseract } = await import('tesseract.js');

  const result = await Tesseract.recognize(file, 'spa+eng');

  const text = result.data.text || '';

  return parseInvoiceText(text);
}

export function parseInvoiceText(text: string): ExtractedInvoice {
  const total = extractTotal(text);
  const date = normalizeDate(text);
  const vendor = extractVendor(text);
  const suggestedCategory = suggestCategory(text);

  return {
    vendor,
    date,
    total,
    suggestedCategory,
    rawText: text,
  };
}

function extractTotal(text: string): number | undefined {
  const keywordRegex =
    /(?:total|importe total|monto total|pagar|saldo|suma|neto)\D{0,25}?([\d.,]{3,})/gi;

  const candidates: number[] = [];

  let match: RegExpExecArray | null;

  while ((match = keywordRegex.exec(text)) !== null) {
    const amount = parseAmount(match[1]);

    if (amount !== undefined) {
      candidates.push(amount);
    }
  }

  if (candidates.length > 0) {
    return Math.max(...candidates);
  }

  const allAmounts = [...text.matchAll(/([\d]{1,3}(?:[.,\d]{3,})?)/g)]
    .map((m) => parseAmount(m[1]))
    .filter((value): value is number => value !== undefined && value > 0);

  if (allAmounts.length > 0) {
    return Math.max(...allAmounts);
  }

  return undefined;
}

function parseAmount(raw: string): number | undefined {
  let value = raw.replace(/[^0-9.,]/g, '');

  if (!value) {
    return undefined;
  }

  const hasComma = value.includes(',');
  const hasDot = value.includes('.');

  if (hasComma && hasDot) {
    const lastComma = value.lastIndexOf(',');
    const lastDot = value.lastIndexOf('.');

    if (lastComma > lastDot) {
      // Formato europeo: 1.234,56
      value = value.replace(/\./g, '').replace(',', '.');
    } else {
      // Formato inglés: 1,234.56
      value = value.replace(/,/g, '');
    }
  } else if (hasComma && !hasDot) {
    if (/^\d{1,3}(,\d{3})+$/.test(value)) {
      // Miles con coma: 1,234
      value = value.replace(/,/g, '');
    } else {
      // Decimal con coma: 1234,56
      value = value.replace(',', '.');
    }
  } else if (!hasComma && hasDot) {
    if (/^\d{1,3}(\.\d{3})+$/.test(value)) {
      // Miles con punto: 1.234
      value = value.replace(/\./g, '');
    }
  }

  const parsed = parseFloat(value);

  if (Number.isNaN(parsed)) {
    return undefined;
  }

  return parsed;
}

function normalizeDate(text: string): string | undefined {
  const isoMatch = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);

  if (isoMatch) {
    const year = isoMatch[1];
    const month = pad2(parseInt(isoMatch[2], 10));
    const day = pad2(parseInt(isoMatch[3], 10));

    return `${year}-${month}-${day}`;
  }

  const dmyMatch = text.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);

  if (dmyMatch) {
    let day = parseInt(dmyMatch[1], 10);
    let month = parseInt(dmyMatch[2], 10);
    let year = parseInt(dmyMatch[3], 10);

    if (year < 100) {
      year += year > 30 ? 1900 : 2000;
    }

    if (month > 12 && day <= 12) {
      const tmp = day;
      day = month;
      month = tmp;
    }

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
  }

  return undefined;
}

function extractVendor(text: string): string | undefined {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const ignoreRegex =
    /factura|ticket|nota|recibo|fecha|total|iva|importe|folio|cliente|rfc|cuit|nit|dni|calle|av\.|avenida|telefono|tel\.|correo|email/i;

  const vendor = lines.find(
    (line) =>
      line.length > 3 &&
      /[a-zA-ZÁÉÍÓÚÑáéíóúñ]/i.test(line) &&
      !ignoreRegex.test(line)
  );

  return vendor?.slice(0, 80);
}

function suggestCategory(text: string): string | undefined {
  const lower = text.toLowerCase();

  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    const found = keywords.some((keyword) => lower.includes(keyword));

    if (found) {
      return category;
    }
  }

  return undefined;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
