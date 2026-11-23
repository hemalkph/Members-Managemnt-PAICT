# Tute stock — quick guide

**Where:** Manage → Students → **Tute stock** (`/admin/tutes`). Admins have it; give a member (e.g. the Physical Coordinator) access in Members → Edit → page access → *Tute stock*.

Tutes themselves are still added and scheduled on **Fee reminders → Tutes**. Tute stock only keeps their copies.

## First day

1. Pick the batch and month at the top.
2. For every tute on the shelf, press **Count** and type how many copies there are. The first count is saved as the tute's opening stock.
3. Add your printer(s) on **Print jobs → Add printer**, with how many days they usually take.

## Every month

| You did… | Press | What happens |
| --- | --- | --- |
| Sent a tute for printing | ⋯ → **New print job** (or Print jobs → New print job) | The copies show as *Printing*. The copy number is filled in from the Print plan (see below). |
| Printed copies arrived | **Received** on the print job (or ⋯ → Received printed copies) | Copies are added to stock. Part deliveries are fine; the job closes when all copies are in. |
| Gave copies out in class | **Give out** → pick the class | Copies leave stock and count toward that class's month. |
| Copies were spoiled | ⋯ → **Mark damaged** | Copies leave stock. |
| Checked the shelf | **Count** | The difference is saved as a count fix. |

Nothing is ever overwritten: every change is a line in **History**, with who did it. A mistake is fixed by counting again.

## Print plan (what to print)

The **Print plan** tab lists every tute that needs printing, most urgent first:

- **Copies** — what's still to give this month + next month's need + spare copies, minus what's on hand or printing, rounded up to the tute's print batch. The sum is written out under each card.
- **Send to print by** — the start of next month minus the printer's real print time (learned from its past jobs) and 3 spare days. *Print now* means this month is already short.
- **Online / Hall** — how many of each class's students study online (from the latest paid list), so you know how many copies go by post.
- **Also needed in …** — the tute is scheduled the month after too; printing both together saves a press run.
- **Create print job** opens the form with the number filled in.

Until a month's paid list is uploaded, its students are a **forecast** (shown with "~" and a range). Each class's forecast uses whichever simple method has been most accurate for that class; classes with under 4 months of lists use last month × pay-again rate + new students. **How close the forecast has been** shows the last 3 months, forecast vs really paid.

**Spare copies** = safety copies (bigger when the forecast is less sure, at least 5% and at least 5) + the usual loss (damaged and counted-short copies over the last 6 months, per copy given out).

## Odd numbers

A count that's far off this tute's usual count fixes, or more copies given to a class than it has students, gets a warning in **History** and an alert. Check the shelf and the last handouts, then count again if needed.

## What the columns mean

- **On hand** — copies on the shelf now.
- **Printing** — copies in open print jobs that haven't arrived yet.
- **Still to give** — students who paid that month (or the forecast while its paid list isn't in, whichever is higher), minus copies already given. Hover it to see each class.
- **Needed next month** — the same for next month.
- **Status** — *Out* (none left and still needed), *Low* (on hand + printing doesn't cover this month, next month and the spare copies, or below the "always keep at least" setting), *OK*, or *Not scheduled*.

## Alerts

Everyone with the Tute stock page gets a bell and phone alert:

- when a tute becomes **Low** or **Out** (once each time it gets worse),
- when next month is close (the printer's real print time + 3 days) and a needed tute has no print job,
- when a count or handout looks odd,
- when a print job is past its due date.

They are checked every day at 9:00, after every stock change, and when someone opens Tute stock. The sidebar shows how many tutes are low or out.

## Settings per tute (⋯ → Settings)

- **Pages** — for later postage and paper estimates.
- **Print in batches of** — suggested print numbers are rounded up to this.
- **Always keep at least** — optional minimum; leave empty to warn only when this month and next aren't covered.

A tute with stock or print history can't be deleted from the catalog; remove it from its months instead.
