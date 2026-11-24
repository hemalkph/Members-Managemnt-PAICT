# Fee Reminders — Team User Guide

The **Fee reminders** page (`/admin/fee-reminders`) compares your **previous month** and **current month** paid student exports class-by-class, automatically flags students who have not yet paid for the ongoing month, and lets your team send customizable **WhatsApp reminders (English or Helakuru Sinhala + emojis)** while tracking who has already been contacted.

---

## 1. Where to Find It & Who Has Access

- **Location:** Sidebar → **Manage → Students → Fee reminders** (or press `⌘K` / `Ctrl+K` and search `Fee reminders`).
- **Permissions:**
  - **Main Admins & Admins:** Full **Edit** access by default (requires two-step login).
  - **Team Members:** Main admins can grant **Edit** or **Read-only** access in **Members → Edit member → Page access → Fee reminders** (the member must have two-step login turned on).
  - **Privacy note:** Concession card cross-labels (Free / Half / Paid card) only appear for staff who *also* have access to the **Concession students** page.

---

## 2. How Batches, Classes & Months Work

Each A/L batch (from **Batches & exams**, e.g. `2027 A/L`) can hold **multiple separate classes** (e.g. `2027 Grand Revision`, `2027 Theory`, `2027 Paper Class`).

- Every class stores its own **isolated monthly paid lists** — uploading one class never overlaps or overwrites another class in the same batch.
- You can create classes manually with **`+ Add class`**, or let the uploader **auto-detect and create them** directly from the `Classes` column of your Excel/CSV file.

---

## 3. Uploading Monthly Paid Lists (`.xlsx` or `.csv`)

Click **`Upload month (.xlsx / .csv)`** at the top right.

### Supported Files (Both LMS Export Formats)
- **Standard Paid Student exports (`.xlsx` / `.csv`)** — with `Gmail`, `Student Name`, `WhatsApp` / `Mobile`, `Classes`, `Total Amount (Rs.)`, and optional `Label` / `New Students` / `Summary` sheets.
- **Enrollments exports (`.csv` / `.xlsx`)** — with `Student name`, `Class`, `Status`, `Method`, `Access state`, `Student index`, `District`, `Mobile`, and the trailing `Item,Value` report footer.
- **You can freely mix formats across months** (e.g., an Enrollments CSV for October and a Standard `.xlsx` export for November) — students still match accurately by normalized phone number.
- **Automatic cleanup:**
  - **Rejected, failed, pending, cancelled, and revoked attempts are excluded automatically before deduplication.** If a student had a `failed` card attempt or `rejected` bank slip and then an `activated` payment in the same sheet, only their valid payment is kept and the failed attempt is never counted as paid or as a duplicate payment. (`Status = activated` + `Access state = expired` is still counted as paid, since past-month access naturally expires.)
  - `FREE_ENROLLMENT` rows are automatically tagged with the **`Free enrollment`** label so you can filter them out with the **Label filter** or **Hide Free card** switch.
  - Extra **"New Students"**, **"Summary" (`Metric, Value`)**, and **report footer (`Item, Value`)** sections or sheets are skipped automatically.
  - Phone numbers are normalized automatically (`078...`, `9478...`, `+94 77...`, Excel-stripped `774...`, scientific notation like `9.478E+10`, and international numbers like `+39...`).
  - Genuine duplicate paid rows for the same student in the same month (e.g. paid twice under two Gmails or same phone/index) are merged cleanly, while **siblings sharing a parent's phone** are kept separate.

### Single-Class vs. Multi-Class (Hybrid) Uploads
- **Single-class file:** Shows 1 detected class (e.g. `2027 Grand Revision` extracted from `2027 Grand Revision - October Class (2027 A/L)`), auto-matches it to the existing class in the batch (or offers to create it), and warns you if the file appears to belong to a different class than the one currently open.
- **Multi-class file:** Automatically detects every class in the `Classes` column (including students with `Classes Count > 1`) and displays each class as its own checkbox card so you can import all of them into separate classes in one step. The uploader blocks mapping two detected classes into the same target class to prevent overlap.

### Typical Monthly Workflow
1. **First time for a class:** Upload **Previous Month** (e.g. `October 2026`), then upload **Current Month** (e.g. `November 2026`).
2. **Mid-month updates (as more students pay):** Re-upload the updated **Current Month** file anytime (from the top button or the **Uploaded Months** tab):
   - Students who just paid automatically move from **Due** → **Paid both months**.
   - Students who are still unpaid **keep all their existing WhatsApp "Messaged" counts, timestamps, labels, and notes**.
3. **Next month (e.g. December):** November is already saved in the system — just upload **December**, and it will automatically compare **November (Previous)** vs **December (Current)**.

---

## 4. Reading the Comparison Table, Matching & Labels

At the top of the page, KPI cards summarize:
- **Paid in `<Prev Month>`:** Baseline students from the previous month.
- **Paid both (`%`):** Students who paid in both months (plus retention rate and count of new students).
- **Flagged Due:** Students who paid last month but are not in this month's list yet.
- **WhatsApp Sent:** How many due students have been messaged and how many remain.

### Smart Identity Matching
Students are matched 1-to-1 across months in two passes:
1. **Exact Gmail match** first.
2. **WhatsApp / Mobile phone fallback** (for compatible names) — if a student switched to a new Gmail this month, they are still recognized as **Paid both months** and shown with a **`Matched by phone`** badge and their new Gmail so you never message a student who already paid.

### Statuses & Filters
Use the filter pills to focus on any group:
- **Unmessaged Due** — Flagged unpaid students nobody has contacted yet.
- **Messaged** — Due students already contacted (shows `×1`, `×2`, last sent time, and which teammate sent it).
- **All Due** — Every unpaid student from the previous month.
- **Paid Both** — Confirmed paid for both months.
- **New / Current Only** — Paid this month only (new or returning from earlier months).
- **Excused / Left** — Students manually triaged out of the active queue.

### Labels & Triage
Labels appear in the **Labels** column and can be filtered with the **All labels** dropdown or the **Hide Free card** switch:
- **Export labels:** Automatically imported if your sheet includes a `Label`, `Card`, `Card Type`, `Fee Type`, `Concession`, or `Category` column.
- **Fee hints:** Automatically flags `Free / Rs. 0` or reduced fees compared to the class median.
- **Custom triage labels & notes:** Click the **Tag icon** on any due row to set status (`Due`, `Messaged`, `Excused`, `Left class`), pick a quick label (`Free card`, `Half card`, `Paid card`, `Promised to pay`, `Paid (receipt pending)`, `Wrong number`, `Left class`) or type your own, and add a note.

### Exporting to CSV
Click **`Export CSV`** to download whichever filtered view you are currently looking at (e.g. `Unmessaged Due` with labels, phone numbers, statuses, and notes).

---

## 5. Customizing WhatsApp Message Templates (English, Sinhala & Emojis)

Open the **`WhatsApp Templates`** tab to manage templates shared across your team.

- **Create / Edit / Duplicate / Delete:** Keep multiple templates ready (e.g., *1st Friendly Reminder (English)*, *Friendly Reminder (Sinhala)*, *Final Notice*) and toggle **Default template** on the one you use most.
- **Formatting buttons:** Highlight text and click **B** (`*bold*`), **I** (`_italic_`), or **S** (`~strike~`).
- **Emoji picker:** Click **`Add emoji`** to insert emojis at your cursor (you can also type or paste any emoji from your OS/keyboard).
- **Live WhatsApp Preview:** Check exactly how your message, emojis, and bold formatting look for a real student from your Due list before sending.

### Available Placeholders
Tap any chip below the editor to insert it at your cursor:

| Placeholder | Replaced With | Example |
| :--- | :--- | :--- |
| `{first_name}` | Student's first name | `Ayodya` |
| `{name}` | Student's full name | `Ayodya Karunasena` |
| `{class}` | Class name | `2027 Grand Revision` |
| `{month}` | Current due month (English) | `November 2026` |
| `{prev_month}` | Previous paid month (English) | `October 2026` |
| `{month_si}` | Current due month (Sinhala) | `නොවැම්බර්` |
| `{prev_month_si}` | Previous paid month (Sinhala) | `ඔක්තෝබර්` |
| `{amount}` | Fee amount from previous month | `Rs. 3,000` |
| `{institute}` | Institute or Online | `Online` |
| `{label}` | Student's label (if any) | `Half card` |
| `{tutes}` | Current due month's tutes (comma-separated) | `Unit 07 Database, SQL Pack` |
| `{tutes_list}` | Current due month's tutes (emoji bulleted list) | `📘 Unit 07 Database`<br>`📘 SQL Pack` |
| `{tute_count}` | Number of tutes scheduled for the due month | `2` |
| `{next_month_tutes}` | Next calendar month's pre-scheduled tutes | `Unit 08 Networking` |
| `{next_month_tutes_list}` | Next month's tutes (emoji bulleted list) | `📘 Unit 08 Networking` |

---

## 5B. Managing Monthly & Future-Month Tutes

Tutes are **created on Tute stock** (Manage → Students → Tute stock → **New tute**), where their copies are kept too. Fee reminders only picks them.

Open the **`Tutes`** tab for any selected Batch and Class:

- **Different tutes per month:** Choose any month in **Schedule month** (past, current, or **up to 12 future months ahead**) to arrange that month's tutes — even before student paid lists are uploaded.
- **Pick tutes one by one:** In **Add a tute to …**, choose a tute of the batch and press **Add**. Repeat for each tute, and for each month or class that uses it.
- **No tute in the list?** Press **Create or edit tutes on Tute stock**, add it there, and come back.
- **Reorder or remove:** Use ↑ / ↓ arrows to control the exact order shown in `{tutes_list}`, or click **×** to unlink a tute from a single month while keeping it in the catalog (its stock on Tute stock is kept).
- **Missing-tutes guard:** If your selected WhatsApp template uses `{tutes}` or `{tutes_list}` while the current month has 0 tutes added yet, a yellow banner alerts you right above the Due table and inside the WhatsApp Queue.

### Using Helakuru for Sinhala Templates
- Always type or paste using **Helakuru Unicode mode** (the default in Helakuru Mobile, Helakuru Web, and Helakuru Desktop Unicode mode — the same mode used in WhatsApp).
- Avoid legacy print-font encodings (FM-Abhaya / DL-Manel), as WhatsApp only displays Unicode Sinhala.
- Use `{month_si}` and `{prev_month_si}` in Sinhala templates so month names render naturally (e.g. `*නොවැම්බර්* මාසයේ පන්ති ගාස්තුව`).
- All WhatsApp links use `api.whatsapp.com/send`, which keeps Sinhala conjuncts (`ක්‍ර`, `ප්‍ර`, `ද්‍ය`, `ශ්‍රී`) and emojis completely intact.

---

## 6. Sending WhatsApp Reminders

Choose your active template in the action bar above the table, then send either in bulk via the **Guided Queue** or individually per row.

### Option A — Guided WhatsApp Queue (Fastest for Batches)
1. Click **`Send WhatsApp Queue (N left)`**.
2. Review the switches at the top of the modal:
   - **Skip Free card** *(on by default)* — skips students labeled as Free card.
   - **Include already messaged** *(off by default)* — turn this **on** when doing a 2nd / final reminder round.
3. For each student, review the personalized message (you can edit it or add an emoji for that specific student without changing the saved template).
4. Click **`Open WhatsApp & Mark Sent`**:
   - Opens WhatsApp Web / Desktop / Mobile with the message pre-filled.
   - Immediately logs the reminder (`Messaged ×1`, timestamp, and your name) and advances to the next student.
5. Use **`Copy text`**, **`Skip`**, **`Excused`**, or **`Left class`** whenever needed.

### Option B — Per-Row Sending
- Click the green **`WhatsApp`** button on any student row to open their chat and log them as messaged immediately.
- Click the **Copy icon** if you prefer pasting manually, or the **Tag icon** to record a note/label.

> **Multi-staff tip:** Because every sent message is saved to the database with who sent it and when, multiple team members can work through the same class's due list without messaging the same student twice (just refresh the page if working at the same time).

---

## 7. Quick Troubleshooting

| Situation | What Happens / What to Do |
| :--- | :--- |
| **Student paid under a new Gmail** | Automatically matched via WhatsApp/Mobile and shown under **Paid Both** with a `Matched by phone` badge. |
| **Student appears twice in one month** | Automatically merged during upload (shown in the preview as `1 duplicate merged`) so they aren't messaged twice. |
| **Two siblings share a parent's phone** | Kept separate as long as their names & Gmails differ, and matched 1-to-1 so one sibling's payment doesn't clear the other. |
| **WhatsApp column is empty** | WhatsApp reminders **only** send to numbers from the `WhatsApp` column (never non-WhatsApp `Mobile` numbers). Students without a WhatsApp number show `No WhatsApp` (with their `Mobile` shown below as call reference only, while `Mobile` is still used behind the scenes to match paid students across months). Re-uploading a month with newly added `WhatsApp` numbers preserves existing follow-ups and highlights only the students whose WhatsApp number changed under **`New WhatsApp #`**. |
| **Uploaded the wrong month by mistake** | Go to the **Uploaded Months** tab and click the trash icon to remove that month, or click **Re-upload** to replace it. |
| **Browser blocked WhatsApp tab** | Allow pop-ups for this workspace in your browser settings so **`Open WhatsApp & Mark Sent`** opens directly in a new tab. |
