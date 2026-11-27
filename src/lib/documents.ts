import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export const BUCKET = 'mcl-documents';
const ALLOWED = new Map([
  ['pdf', 'application/pdf'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['png', 'image/png'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], ['xls', 'application/vnd.ms-excel'], ['csv', 'text/csv'],
]);
const MAX = 20 * 1024 * 1024;

// magic-number check so a renamed executable can't be uploaded as a PDF
async function sniff(file: File, mime: string) {
  const b = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const hex = Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
  if (mime === 'application/pdf') return hex.startsWith('25504446');
  if (mime === 'image/png') return hex.startsWith('89504e47');
  if (mime === 'image/jpeg') return hex.startsWith('ffd8ff');
  if (mime.includes('spreadsheetml')) return hex.startsWith('504b0304');
  if (mime === 'application/vnd.ms-excel') return hex.startsWith('d0cf11e0');
  return true; // csv: plain text
}

export async function uploadDocument(sb: SupabaseClient, opts: {
  file: File; docType: string; userId: string; billId?: string | null; referralId?: string | null; queryId?: string | null;
}) {
  const { file } = opts;
  if (!file || file.size === 0) throw new Error('Choose a file.');
  if (file.size > MAX) throw new Error(`${file.name}: larger than 20 MB.`);
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const mime = ALLOWED.get(ext);
  if (!mime) throw new Error(`${file.name}: only PDF, JPG, PNG, XLSX, XLS or CSV files are allowed.`);
  if (!(await sniff(file, mime))) throw new Error(`${file.name}: file content does not match its extension.`);

  const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
  const folder = opts.billId ? `bills/${opts.billId}` : `referrals/${opts.referralId}`;
  const path = `${folder}/${crypto.randomUUID()}-${safe}`;
  const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: mime, upsert: false });
  if (up.error) throw new Error(`Upload failed: ${up.error.message}`);
  const { data, error } = await sb.from('supporting_documents').insert({
    bill_id: opts.billId ?? null, referral_id: opts.referralId ?? null, query_id: opts.queryId ?? null,
    doc_type: opts.docType, file_name: file.name, storage_path: path, mime_type: mime, size_bytes: file.size,
    uploaded_by: opts.userId,
  }).select('id').single();
  if (error) throw new Error(error.message);
  return { id: data.id as string, path };
}
