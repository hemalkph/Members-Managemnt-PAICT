// App-wide switches.

/**
 * Account numbers are masked everywhere (****1234). Only the owner gets a
 * "Show" button. Set this to true if admins (e.g. Payment Clearance) should
 * also be able to reveal full account numbers when paying members.
 */
export const ADMINS_CAN_REVEAL_ACCOUNT_NUMBER = false;

/**
 * Members see the estimated amount for their own work (quantity × rate) on
 * their submissions and dashboard. Set to false to hide money from members.
 */
export const SHOW_MEMBERS_THEIR_EARNINGS = true;
