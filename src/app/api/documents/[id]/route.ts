import { NextResponse, type NextRequest } from 'next/server';
import { getUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { BUCKET } from '@/lib/documents';

/** Redirects to a 5-minute signed URL — only if RLS lets the caller read the document row. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await getUser())) return new NextResponse('Unauthorised', { status: 401 });
  const sb = await supabaseServer();
  const { data: doc } = await sb.from('supporting_documents').select('storage_path, file_name').eq('id', id).maybeSingle();
  if (!doc) return new NextResponse('Not found', { status: 404 });
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(doc.storage_path, 300, { download: false });
  if (error || !data) return new NextResponse('Document unavailable', { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
