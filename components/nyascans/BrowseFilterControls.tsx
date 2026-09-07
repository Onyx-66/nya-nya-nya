"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, BookOpenText, CaretDown, Check, Clock, Compass, HashStraight, Heart, MagnifyingGlass, SlidersHorizontal, Tag, UsersThree, X } from "./heroicons";
import { LanguageFlag } from "./LanguageFlag";
import { useDropdownSurface } from "./useDropdownSurface";

export type BrowseFacet = { value: string; label: string; country?: string };
export type BrowseFilterValues = {
  status: string; type: string; origin: string; genre: string; tag: string; creator: string;
  sort: string; sortDirection: "asc" | "desc"; onSale: boolean; hideFollowed: boolean;
};

function FilterMenu({ label, value, options, icon, onChange, multiple = true, searchable = false, children }: {
  label: string; value: string; options: BrowseFacet[]; icon: ReactNode;
  onChange(value: string): void; multiple?: boolean; searchable?: boolean; children?: ReactNode;
}) {
  const root = useRef<HTMLDetailsElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = value.split(",").filter((entry) => entry && entry !== "All");
  useDropdownSurface(open, root, panel);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target) && root.current) root.current.open = false; };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return <details ref={root} className="browse-filter-menu" onToggle={(event) => {
    const next = event.currentTarget.open;
    setOpen(next);
    if (next) event.currentTarget.closest(".catalog-filter-panel")?.querySelectorAll<HTMLDetailsElement>("details[open]").forEach((item) => { if (item !== event.currentTarget) item.open = false; });
  }} onKeyDown={(event) => { if (event.key === "Escape" && root.current) { event.stopPropagation(); root.current.open = false; root.current.querySelector("summary")?.focus(); } }}>
    <summary aria-label={`${label}: ${selected.map((item) => options.find((option) => option.value === item)?.label ?? item).join(", ") || "All"}`}>
      {icon}<span>{label}</span>{selected.length && (multiple || value !== "latest") ? <b>{multiple ? selected.length : "1"}</b> : null}<CaretDown size={15} aria-hidden="true" />
    </summary>
    <div ref={panel} className="browse-filter-options">
      {searchable ? <label className="browse-filter-search"><MagnifyingGlass size={17} /><input type="search" aria-label={`Search ${label.toLowerCase()}`} placeholder={`Search ${label.toLowerCase()}…`} value={search} onChange={(event) => setSearch(event.target.value)} /></label> : <strong>{label === "Origins" ? "Origin" : label}</strong>}
      {children}
      <div className="browse-filter-choices" role={multiple ? "group" : "radiogroup"} aria-label={`${label} options`}>
        {multiple ? <button type="button" className="browse-filter-choice" role="checkbox" aria-checked={!selected.length} onClick={() => onChange("")}><span className="browse-choice-check">{!selected.length ? <Check size={13} /> : null}</span><span>All {label.toLowerCase()}</span></button> : null}
        {options.filter((option) => option.label.toLowerCase().includes(search.toLowerCase())).map((option) => {
          const checked = selected.includes(option.value);
          return <button key={option.value} type="button" role={multiple ? "checkbox" : "radio"} aria-checked={checked} className="browse-filter-choice" onClick={() => {
            onChange(multiple ? (checked ? selected.filter((item) => item !== option.value) : [...selected, option.value]).join(",") : option.value);
            if (!multiple && root.current) root.current.open = false;
          }}><span className="browse-choice-check">{checked ? <Check size={13} /> : null}</span>{option.country ? <LanguageFlag country={option.country} showCode={false} /> : null}<span>{option.label}</span></button>;
        })}
        {!options.some((option) => option.label.toLowerCase().includes(search.toLowerCase())) ? <p>No matching options.</p> : null}
      </div>
    </div>
  </details>;
}

export function BrowseFilterControls({ values, genres, tags, creators, onChange, onHideBookmarks, onClear, canClear, mobile = false, children }: {
  values: BrowseFilterValues; genres: BrowseFacet[]; tags: BrowseFacet[]; creators: BrowseFacet[];
  onChange(values: Partial<BrowseFilterValues>): void; onHideBookmarks(): void; onClear(): void;
  canClear: boolean; mobile?: boolean; children?: ReactNode;
}) {
  return <div className={`browse-filter-rows catalog-filter-panel ${mobile ? "is-mobile" : "is-desktop"}`} aria-label="Browse filters">
    <div className="browse-filter-row is-primary">
      <FilterMenu label="Status" value={values.status} icon={<SlidersHorizontal size={18} />} options={[
        {value:"ONGOING",label:"Ongoing"},{value:"COMPLETED",label:"Completed"},{value:"HIATUS",label:"Hiatus"},
        {value:"PAUSED",label:"Paused"},{value:"CANCELLED",label:"Cancelled"},{value:"UPCOMING",label:"Upcoming"},
      ]} onChange={(status) => onChange({status: status || "All"})} />
      <FilterMenu label="Type" value={values.type} icon={<BookOpenText size={18} />} options={[{value:"MANGA",label:"Manga"},{value:"MANHWA",label:"Manhwa"},{value:"MANHUA",label:"Manhua"}]} onChange={(type) => onChange({type: type || "All"})} />
      <FilterMenu label="Origins" value={values.origin} icon={<Compass size={18} />} options={[{value:"KR",label:"Korean",country:"KR"},{value:"JP",label:"Japanese",country:"JP"},{value:"CN",label:"Chinese",country:"CN"},{value:"OTHER",label:"Other"}]} onChange={(origin) => onChange({origin})} />
      <FilterMenu label="Genres" value={values.genre} icon={<SlidersHorizontal size={18} />} options={genres} searchable onChange={(genre) => onChange({genre})} />
      <FilterMenu label="Tags" value={values.tag} icon={<HashStraight size={18} />} options={tags} searchable onChange={(tag) => onChange({tag})} />
      <FilterMenu label="Creator" value={values.creator} icon={<UsersThree size={18} />} options={creators} searchable onChange={(creator) => onChange({creator})} />
    </div>
    <div className="browse-filter-row is-secondary">
      <FilterMenu label="Update" value={values.sort} icon={<Clock size={18} />} multiple={false} options={[
        {value:"latest",label:"Latest update"},{value:"added",label:"Recently added"},{value:"viewed",label:"Most viewed"},
        {value:"followed",label:"Most followed"},{value:"rated",label:"Highest rated"},{value:"title",label:"Alphabetical"},
      ]} onChange={(sort) => onChange({sort})}>
        <div className="browse-sort-direction" role="group" aria-label="Sort direction">
          <button type="button" aria-pressed={values.sortDirection === "asc"} onClick={() => onChange({sortDirection:"asc"})}><ArrowUp size={15} /> Ascending</button>
          <button type="button" aria-pressed={values.sortDirection === "desc"} onClick={() => onChange({sortDirection:"desc"})}><ArrowDown size={15} /> Descending</button>
        </div>
      </FilterMenu>
      <button type="button" className="browse-on-sale" aria-pressed={values.onSale} onClick={() => onChange({onSale:!values.onSale})}><Tag size={19} /><span>On Sale</span></button>
      <button type="button" className="browse-hide-bookmarks" aria-pressed={values.hideFollowed} onClick={onHideBookmarks}><Heart size={19} /><span>Hide bookmarks</span><span className="browse-switch" aria-hidden="true"><i /></span></button>
      <button type="button" className="browse-clear-button" disabled={!canClear} onClick={onClear}><X size={18} /><span>Clear filters</span></button>
    </div>
    {children ? <div className="browse-filter-extra">{children}</div> : null}
  </div>;
}
