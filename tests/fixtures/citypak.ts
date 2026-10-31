// A synthetic Citypak-style export with the same shape and quirks as the
// real sample (59 rows, references 088–147 with 093 missing, a spaced phone,
// a "=+94…" value, numbers without the leading 0). All names, addresses and
// numbers here are made up. The real file never enters the repository.

export const CITYPAK_COLUMNS = [
  "Citypak Tracking",
  "Your Reference",
  "Sender's Address Name",
  "Sender's Address Line 1",
  "Sender's Address Line 2",
  "Sender's Address Line 3",
  "Sender's Address Line 4 - City",
  "Sender's Contact Name",
  "Sender's Contact Number 1",
  "Sender's Contact Number 2",
  "Receiver's Address Name",
  "Receiver's Address Line 1",
  "Receiver's Address Line 2",
  "Receiver's Address Line 3",
  "Receiver's Address Line 4 - City",
  "Receiver's Contact Number 1",
  "Receiver's Contact Number 2",
  "Receiver's Contact Nic",
  "Weight g",
  "Billing Type",
  "Item Type",
  "Number Of Pieces",
  "Description",
  "Is Cash On Delivery",
  "Collection Amount",
] as const;

const FIRST = ["Amaya", "Bimal", "Chathu", "Dinuk", "Eshani", "Farah", "Gihan", "Hasini", "Isuru", "Janani"];
const LAST = ["Perera", "Silva", "Fernando", "Jayasinghe", "Wickrama", "Bandara"];
const CITIES = ["Colombo", "Kandy", "Galle", "Matara", "Kurunegala", "Horana", "Negombo"];

export type FixtureRow = string[];

/** 59 synthetic rows in Citypak's column order. */
export function syntheticCitypakRows(): FixtureRow[] {
  const rows: FixtureRow[] = [];
  let tracking = 10000000;
  for (let n = 88; n <= 147; n++) {
    if (n === 93) continue; // the sample has a gap here too
    const no = String(n).padStart(3, "0");
    let phone = `7${String(10000000 + n * 1234).slice(0, 8)}`; // 9 digits, no leading 0
    if (no === "092") phone = "077 1163730";
    if (no === "126") phone = "=+94741043970";
    const city = CITIES[n % CITIES.length];
    rows.push([
      `D${tracking++}`,
      `27TGROCTICT${no}`,
      "PAICT TEST SENDER",
      "1 Test Road",
      "",
      "",
      "Testville",
      "",
      "0710000000",
      "",
      `${FIRST[n % FIRST.length]} ${LAST[n % LAST.length]} ${no}`,
      `${n}/A Example Lane, ${city}`,
      "",
      "",
      city,
      phone,
      "",
      "",
      "1000",
      "SENDER ACCOUNT",
      "SENDER ACCOUNT",
      "1",
      "",
      "YES",
      "500",
    ]);
  }
  return rows;
}
