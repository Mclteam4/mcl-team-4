import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { supabaseServer } from './supabase/server';

export type Role = 'admin' | 'hospital' | 'amo' | 'finance' | 'management';
export interface AppUser {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  hospital_id: string | null;
  area_id: string | null;
  designation: string | null;
  active: boolean;
}

export const ROLE_HOME: Record<Role, string> = {
  admin: '/admin', hospital: '/hospital', amo: '/amo', finance: '/finance', management: '/management',
};
export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrator', hospital: 'Hospital', amo: 'AMO / Doctor', finance: 'Finance', management: 'Management',
};

/** Signed-in, active application user (verified with Supabase Auth on every request). */
export const getUser = cache(async (): Promise<AppUser | null> => {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb.from('users').select('id,email,full_name,role,hospital_id,area_id,designation,active')
    .eq('id', user.id).maybeSingle();
  if (!data || !data.active) return null;
  return data as AppUser;
});

export async function requireUser(...roles: Role[]): Promise<AppUser> {
  const u = await getUser();
  if (!u) redirect('/login');
  if (roles.length && !roles.includes(u.role)) redirect(ROLE_HOME[u.role]);
  return u;
}

/** For server actions: returns the user or throws (never redirects mid-action). */
export async function actionUser(...roles: Role[]): Promise<AppUser> {
  const u = await getUser();
  if (!u) throw new Error('Your session has expired. Please sign in again.');
  if (roles.length && !roles.includes(u.role)) throw new Error('You are not authorised for this action.');
  return u;
}
