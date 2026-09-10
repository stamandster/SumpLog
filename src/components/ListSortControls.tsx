/** Mobile equivalents of table headers: buttons retain sorting without a dropdown. */
export function ListSortControls({ sort, onSort, columns }: { sort: string; onSort: (value: string) => void; columns: Array<[string, string, string]> }) {
  return <div className="mobile-list-sort" aria-label="Sort list">{columns.map(([label, ascending, descending]) => {
    const active = sort === ascending || sort === descending;
    const direction = sort === descending ? "descending" : "ascending";
    return <button type="button" className="sort-toggle" key={label} aria-pressed={active} aria-label={`Sort by ${label}${active ? `, currently ${direction}` : ""}`} onClick={() => onSort(sort === ascending ? descending : ascending)}>{label}{active ? sort === descending ? " ↓" : " ↑" : ""}</button>;
  })}<span className="sr-only" role="status">Sorted by {columns.find(([, a, d]) => sort === a || sort === d)?.[0]}, {columns.some(([, , d]) => sort === d) ? "descending" : "ascending"}</span></div>;
}
