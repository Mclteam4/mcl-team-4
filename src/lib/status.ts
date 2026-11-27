export type Tone = 'green' | 'red' | 'yellow' | 'grey' | 'blue' | 'navy';

export const BILL_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Draft', tone: 'grey' },
  SUBMITTED: { label: 'New – Pending AMO', tone: 'yellow' },
  UNDER_VERIFICATION: { label: 'Under Verification', tone: 'yellow' },
  REVISION_REQUESTED: { label: 'Revision Requested', tone: 'red' },
  SENT_TO_HOSPITAL: { label: 'Awaiting Hospital Acceptance', tone: 'blue' },
  QUERY_RAISED: { label: 'Query Raised', tone: 'red' },
  ACCEPTED: { label: 'Accepted by Hospital', tone: 'green' },
  DEEMED_ACCEPTED: { label: 'Deemed Accepted', tone: 'green' },
  PENDING_FINANCE: { label: 'Pending Finance Verification', tone: 'yellow' },
  FINANCE_RETURNED: { label: 'Returned for Clarification', tone: 'red' },
  FINANCIALLY_APPROVED: { label: 'Financially Approved', tone: 'green' },
  PAYMENT_PROCESSED: { label: 'Payment Processed', tone: 'blue' },
  PAYMENT_COMPLETED: { label: 'Payment Completed', tone: 'green' },
  REJECTED: { label: 'Rejected', tone: 'red' },
};
export const BILL_STATUSES = Object.keys(BILL_STATUS);

export const MATCH: Record<string, { label: string; tone: Tone }> = {
  GREEN: { label: 'Within CGHS', tone: 'green' },
  RED: { label: 'Exceeds CGHS', tone: 'red' },
  YELLOW: { label: 'Manual check', tone: 'yellow' },
  GREY: { label: 'Rate not found', tone: 'grey' },
};

export const DECISION: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: 'Pending', tone: 'grey' },
  APPROVED: { label: 'Approved', tone: 'green' },
  MODIFIED: { label: 'Modified', tone: 'yellow' },
  PARTIAL: { label: 'Partially approved', tone: 'yellow' },
  DISALLOWED: { label: 'Disallowed', tone: 'red' },
};

export const CATEGORIES = [
  ['MEDICINE', 'Medicine'], ['PROCEDURE', 'Procedure'], ['PACKAGE', 'CGHS Package'], ['INVESTIGATION', 'Investigation'],
  ['ROOM_RENT', 'Room Rent'], ['ICU', 'ICU'], ['CONSULTATION', 'Consultation'], ['IMPLANT', 'Implant'],
  ['CONSUMABLE', 'Consumable'], ['OTHER', 'Other'],
] as const;
export const categoryLabel = (c: string) => CATEGORIES.find(([k]) => k === c)?.[1] ?? c;

export const DOC_TYPES = [
  ['FINAL_BILL', 'Final hospital bill'], ['DISCHARGE_SUMMARY', 'Discharge summary'],
  ['INVESTIGATION_REPORT', 'Investigation report'], ['PRESCRIPTION', 'Prescription'],
  ['MEDICINE_BILL', 'Medicine bill'], ['PROCEDURE_DETAILS', 'Procedure details'],
  ['QUERY_SUPPORT', 'Query supporting document'], ['OTHER', 'Other'],
] as const;

export const WARDS = [['GENERAL', 'General'], ['SEMI_PRIVATE', 'Semi-Private'], ['PRIVATE', 'Private']] as const;
export const CITY_CLASSES = [['TIER_I', 'Tier I'], ['TIER_II', 'Tier II'], ['TIER_III', 'Tier III']] as const;

/** Statuses in which the bill is "with" each party — used by dashboards. */
export const WITH_AMO = ['SUBMITTED', 'UNDER_VERIFICATION', 'QUERY_RAISED'];
export const WITH_HOSPITAL = ['DRAFT', 'REVISION_REQUESTED', 'SENT_TO_HOSPITAL'];
export const WITH_FINANCE = ['PENDING_FINANCE', 'FINANCE_RETURNED', 'FINANCIALLY_APPROVED', 'PAYMENT_PROCESSED'];
