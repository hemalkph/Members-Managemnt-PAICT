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

/**
 * The payroll CSV (Analytics > Payroll CSV, main admins only) includes each
 * member's FULL account number so salaries and work payments can be made.
 * Set to false to export masked numbers (****1234) instead.
 */
export const PAYROLL_CSV_INCLUDES_FULL_ACCOUNT_NUMBER = true;

/**
 * Members can open and download their own payslips (My payslips) once a
 * month is closed. Set to false to keep payslips for main admins only.
 */
export const MEMBERS_CAN_SEE_PAYSLIPS = true;

/** Name printed at the top of payslips. */
export const PAYSLIP_ORGANISATION = "PA ICT – A/L ICT Class Team";
