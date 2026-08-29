/**
 * Support contact points. One definition so the number in Profile, the trip
 * screen and the Support tab can never drift apart.
 */
export const SUPPORT_PHONE = '1800-200-1234';
export const SUPPORT_HOURS = 'Every day, 7:00 AM – 9:00 PM';

export interface IssueTopic {
  key: string;
  icon: string;
  label: string;
  detail: string;
}

export const ISSUE_TOPICS: IssueTopic[] = [
  {
    key: 'driver',
    icon: 'local-shipping',
    label: 'Problem with my driver',
    detail: 'Late pickup, wrong route, or the driver is not reachable.',
  },
  {
    key: 'produce',
    icon: 'inventory-2',
    label: 'Damage to my produce',
    detail: 'Crates broken, load spoiled, or weight does not match.',
  },
  {
    key: 'payment',
    icon: 'payments',
    label: 'Payment or billing',
    detail: 'A charge you did not expect, or a refund that has not arrived.',
  },
  {
    key: 'other',
    icon: 'help-outline',
    label: 'Something else',
    detail: 'Anything the topics above do not cover.',
  },
];
