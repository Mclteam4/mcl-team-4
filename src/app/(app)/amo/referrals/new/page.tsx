import { requireUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui';
import { ReferralForm } from '@/components/ReferralForm';

export const metadata = { title: 'New referral' };

export default async function NewReferral() {
  await requireUser('amo');
  const sb = await supabaseServer();
  const { data: hospitals } = await sb.from('hospitals').select('id, name, city').eq('active', true).order('name');
  return (
    <div>
      <PageHeader title="New patient referral" subtitle="The referral ID is generated automatically. Bills against it will come to you for verification." />
      <ReferralForm hospitals={(hospitals ?? []).map((h) => ({ id: h.id, name: `${h.name}, ${h.city}` }))} />
    </div>
  );
}
