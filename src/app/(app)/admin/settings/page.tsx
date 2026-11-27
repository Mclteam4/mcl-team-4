import { requireUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/format';
import { Card, PageHeader, Notice } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { saveSetting } from '../actions';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  await requireUser('admin');
  const sb = await supabaseServer();
  const { data: settings } = await sb.from('system_settings').select('*').order('key');
  return (
    <div className="space-y-5">
      <PageHeader title="System settings" subtitle="Rule values used by the verification engine and workflow. Every change is recorded in the audit log." />
      <Notice tone="yellow">Rate factors and room-rent ceilings must match the CGHS Office Memorandum applicable to MCL. Changes affect only verification rounds started after saving; earlier rounds keep the rules they used.</Notice>
      <div className="grid gap-5 xl:grid-cols-2">
        {settings?.map((st) => (
          <Card key={st.key} title={st.key.replaceAll('_', ' ')}>
            <p className="mb-2 text-xs text-slate-500">{st.description}</p>
            <ActionForm action={saveSetting} className="space-y-2">
              <input type="hidden" name="key" value={st.key} />
              <textarea name="value" rows={typeof st.value === 'object' ? 8 : 1} defaultValue={JSON.stringify(st.value, null, 2)} className="w-full font-mono text-xs" />
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Updated {fmtDateTime(st.updated_at)}</span>
                <SubmitButton className="btn-primary btn-sm">Save</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        ))}
      </div>
    </div>
  );
}
