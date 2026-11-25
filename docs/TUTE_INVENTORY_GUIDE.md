# Tute stock — quick guide

**Where:** Manage → Students → **Tute stock** (`/admin/tutes`). Admins have it; give a member (e.g. the Physical Coordinator) access in Members → Edit → page access → *Tute stock*.

**Tutes are created here.** Press **New tute** (name, short code, pages, optional opening copies, print batch, Paper Library PDF, and optionally tick this month's classes). Schedule months any time on **Classes → Tute plan** — that is what puts it in the WhatsApp messages and tells Tute stock how many copies are needed. Rename, archive or link the PDF later with ⋯ → **Edit tute**.

**One shelf for every batch.** A tute isn't tied to a batch: schedule the same tute for classes in any batch, and its need is the sum of all of them. Names and codes are unique on the shelf. The **Code** column shows each tute's code. In **Papers**, a Type **Tute** item needs no batch, and the Paper Library lists tutes under “Tutes”.

## First day

1. Pick the month at the top.
2. Press **Count all** and type how many copies of each tute are on the shelf (0 if there are none). Blank boxes are skipped. The first count is saved as the tute's opening stock. Until a tute is counted it shows *Not counted*, not *Out*.
3. Add your printer(s) on **Print jobs → Add printer**, with how many days they usually take.

## Every month

| You did… | Press | What happens |
| --- | --- | --- |
| Sent a tute for printing | ⋯ → **New print job** (or Print jobs → New print job) | The copies show as *Printing*. The copy number is filled in from the Print plan (see below). |
| Printed copies arrived | **Received** on the print job (or ⋯ → Received printed copies) | Copies are added to stock. Part deliveries are fine; the job closes when all copies are in. |
| Gave copies out in class | **Hand out** → pick the class (all its tutes at once), or **Give out** on one tute | Copies leave stock and count toward that class's month. Hand out fills in the Hall copies still to give. |
| Copies were spoiled | ⋯ → **Mark damaged** | Copies leave stock. |
| Checked the shelf | **Count all**, or **Count** on one tute | The difference is saved as a count fix. |

**Where the numbers come from:** click a tute. Each class shows its expected students and where that number comes from (the paid list, a forecast, or the month-end estimate, with how many have paid so far). When there is something to print, **Order** shows the sum, for example “143 still to give + 8 spare = 151”.

Each row's main button follows its status: **Count** when not counted, **Order print** (or **Received** when a print job is open) when Out or Low, otherwise **Give out**. Everything else is under ⋯.

Nothing is ever overwritten: every change is a line in **History**, with who did it. A mistake is fixed by counting again.

## Print plan (what to print)

The **Print plan** tab lists every tute that needs printing, most urgent first:

- **Copies** — what's still to give this month + next month's need + spare copies, minus what's on hand or printing, rounded up to the tute's print batch. The sum is written out under each card.
- **Send to print by** — the start of next month minus the printer's real print time (learned from its past jobs) and 3 spare days. *Print now* means this month is already short.
- **Online / Hall** — how many of each class's students get their tutes by post (from the latest Speed Post list), so you know how many copies go by post.
- **Also needed in …** — the tute is scheduled the month after too; printing both together saves a press run.
- **Create print job** opens the form with the number filled in.

Until a month's paid list is uploaded, its students are a **forecast** (shown with "~" and a range). Each class's forecast uses whichever simple method has been most accurate for that class; classes with under 4 months of lists use last month × pay-again rate + new students. **How close the forecast has been** shows the last 3 months, forecast vs really paid.

**Spare copies** = safety copies (bigger when the forecast is less sure, at least 5% and at least 5) + the usual loss (damaged and counted-short copies over the last 6 months, per copy given out).

**Paid so far:** a class's count is the newest of its uploaded paid list (Fee reminders) and a count typed on **Classes** (type it each day if you like). The Online / Hall split comes from the class's latest **Speed Post list** (students on it, against the paid count). Until a class has one, its **mode** on Classes is used: *Online* all, *Physical* none, *Physical + Online* by the paid list's Institute column.

**Mid-month forecast:** if you upload the paid list or type a count a few times a month, Tute stock learns how payments usually come in (each batch learns its own). After 4 past months in a batch it scales an early upload up to a month-end estimate (shown as "~160, 120 paid so far at the usual pace"). The Print plan shows the batch that has learned least.

## Odd numbers

A count that's far off this tute's usual count fixes, or more copies given to a class than it has students, gets a warning in **History** and an alert. Check the shelf and the last handouts, then count again if needed.

## What the columns mean

- **On hand** — copies on the shelf now. Tap it to open **History** filtered to that tute.
- **Printing** — copies in open print jobs that haven't arrived yet.
- **Still to give** — students who paid that month (or the forecast while its paid list isn't in, whichever is higher), minus copies already given. Tap it to see each class.
- **Needed next month** — the same for next month.
- **Status** — *Not counted* (no count, stock or print job yet: count it first), *Out* (none left and still needed), *Low* (on hand + printing doesn't cover this month, next month and the spare copies, or below the "always keep at least" setting), *OK*, or *Not scheduled*.

## Alerts

Everyone with the Tute stock page gets a bell and phone alert:

- when a tute becomes **Low** or **Out** (once each time it gets worse),
- when next month is close (the printer's real print time + 3 days) and a needed tute has no print job,
- when a count or handout looks odd,
- when a print job is past its due date.

They are checked every day at 9:00, after every stock change, and when someone opens Tute stock. The sidebar shows how many tutes are low or out.

Every **Monday at 9:00** there is also one short summary: tutes low or out, print jobs late or due, and (for Speed Post people) parcels to pack, posted and returned last week.

## Settings per tute (⋯ → Edit tute)

- **Pages** — for later postage and paper estimates.
- **Print in batches of** — suggested print numbers are rounded up to this.
- **Always keep at least** — optional minimum; leave empty to warn only when this month and next aren't covered.

⋯ → **Delete tute** works only for a tute that was never counted, printed or posted. Otherwise edit it and untick **In use** to archive it (**Show archived** brings it back into view).

---

# Speed Post — quick guide

**Where:** Manage → Students → **Speed Post** (`/admin/post`). It holds students' home addresses, so give it only to the people who post tutes.

## Each month

1. **Upload the Speed Post list** (Addresses tab → *Upload list*): pick the class and upload a file of **only the students to post to** this month, with Name, WhatsApp or Mobile, Address and Nearest City. It's separate from the Fee reminders paid list, which no longer saves addresses. Uploading again for the same class replaces its list; *Delete* removes it.
2. **Addresses tab:** check new or changed addresses. *Confirm N that look fine* confirms every address with no warning; open the others (*Too short*, *Needs a town*, *No address*), fix them, and *Save and confirm*.
3. **Rounds tab → Build round.** Everyone on the Speed Post list who has a confirmed address and still needs this month's tutes gets a parcel. Students at the same address share one parcel. The copies are held for the round (Tute stock shows "held for post"). If there isn't enough stock, it says which tutes to print or count first.
4. **Labels** and **Post list** print from the round page.
5. **Pack:** parcels with the same tutes are grouped. Tick each one, or type its number in *Packed parcel number*.
6. **Tracking numbers:** type or scan each Speed Post sticker into its parcel (camera button on Android Chrome).
7. **Handed over at the post office:** when every parcel is packed and tracked. Type the receipt total if you like. Copies leave stock now, once.
8. **Send tracking** opens WhatsApp with the message ready for each student.
9. Students who pay later: **Build top-up round**. Nobody is ever sent the same tute for the same month twice.

## Afterwards

- **Delivered** — optional, for your own tracking.
- **Came back** — choose *Usable* (copies go back into stock) or *Damaged*. The address is marked to check again; once confirmed, the next top-up round sends the tutes again.
- **Lost** — the student can be sent the tutes again in a top-up round.
- **May come back** — once 30 posted parcels have a known outcome, a round marks parcels likely to come back (came back before, a district that often returns them, an unclear address, no WhatsApp). Call the student before posting. Until then the round page says it is still learning.
- **Take out of this round** (before handover) — e.g. the student will collect in person. Their copies become free again.

Addresses and Speed Post lists not used for 18 months are removed automatically.
