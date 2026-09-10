# SumpLog user guide

This guide describes the current single-owner SumpLog application. Most pages use the vehicle selected at the top of the application; Parts, Documents, Insurance, Settings, and Calculators also support garage-wide work where applicable.

## Start with a vehicle

Add a vehicle from Vehicles or the empty-garage prompt. Year, make, model, current mileage, and the mileage date are required. VIN decoding uses the external NHTSA vPIC service and may be unavailable without internet access; decoded values remain editable.

SumpLog estimates annual mileage from vehicle age and current mileage when needed. Add dated readings from Vehicles to improve the observed-use line and projection. Editing a reading or vehicle mileage recalculates the current odometer from the latest dated entry.

Vehicle photos accept JPEG, PNG, and WebP files. Vehicles provides framing controls for rotation, zoom, and position. The original file is retained; dashboards and lists request smaller WebP derivatives for faster loading.

### Deleting a vehicle

Vehicle deletion requires a typed confirmation. It permanently removes that vehicle's maintenance records and audit history, mileage readings, specifications, vehicle-owned projects, reminders, vehicle-only service tasks, related documents, uploaded vehicle photo, and part-fitment links.

Garage inventory items remain, but their link to the deleted vehicle is removed. Insurance policies also remain; only the vehicle-policy link is removed. A service task shared with another vehicle survives and is reassigned to one of its remaining vehicles internally.

Create a JSON backup before deletion when the records may be needed later.

## Log maintenance

Maintenance records include service date, mileage, system/category, total cost, labor hours, difficulty, who performed the work, notes, next-due date or mileage, parts, consumables, and evidence.

Select parts by searching the catalogue and adding one or more results. Whole-item use records a quantity. For a consumable, choose partial use and enter the amount and unit; SumpLog converts that amount into an equivalent fraction of the inventory unit and prorates the recorded part cost. Confirm that the catalogue's volume per unit is correct before relying on the calculation.

You can prepare as many as 50 new attachments in the form before saving. Each may be previewed, given a type and editable display name, and rotated when it is an image. Each file is limited to 15 MB. Supported formats are JPEG, PNG, WebP, PDF, plain text, CSV, DOCX, XLSX, and ODT.

Click a maintenance row to expand or collapse it. Expanded details show linked parts, evidence previews, next-due information, and history/actions. Expand All and Collapse All apply to the currently filtered result set. Search includes maintenance fields and associated part names, numbers, and manufacturers.

Editing a record appends an audit entry. Void a mistaken record instead of deleting its history; voided records can be restored. Deleting an individual attachment permanently removes the document record and its stored file.

### Schedule the next service

A next-due date or mileage on a maintenance record displays as a follow-up. Convert that follow-up into a service task when you want a reusable checklist or interval. Service tasks may apply to one or several vehicles and can create linked reminders. The dashboard suppresses linked reminder duplicates and shows standalone reminders separately.

Click a Next Services row on the dashboard to log it as performed. Completion creates a new maintenance record and advances an interval-based task. The X action removes a maintenance record's next-due follow-up without deleting its service history.

## Manage parts and consumables

Parts is garage-wide inventory. An item can be general stock or linked to several vehicles. Use **Part** for discrete components and **Consumable** for fluids or materials that may be partially used. Consumables can record category, per-unit volume, specifications, and approvals.

Search and dropdown filters cover type, date added, manufacturer, supplier, quantity/stock state, and vehicle. Active filters can be removed individually. Sort from table headers on desktop; compact rows retain primary information and expandable details at narrower widths. Bulk selection supports export and deletion.

Stock quantities are reduced when parts are attached to a saved maintenance record. A part referenced by maintenance cannot be deleted because it is part of the historical record.

## Store specifications

Specifications are tied to a vehicle and grouped by system or purpose. Store the value, source, and notes. Search and filters operate on the current vehicle's list.

**Copy** creates a new specification for another vehicle. **Move** changes the specification's owning vehicle after confirmation; the original vehicle no longer has it. If there is no second vehicle, the Copy or Move workflow directs you to add one.

## Plan projects

Projects use Backlog, Planned, In Progress, Waiting, and Done states. Each project may contain a description, target date, estimated and actual costs, and checklist items with their own estimated costs. A project may be vehicle-specific; deleting that vehicle removes vehicle-owned projects and their documents.

## Work with documents

Documents shows a searchable, filterable gallery. Image previews load lazily. Click an image to open the large photo editor; use Details to open the associated maintenance record. Non-image documents open in a new tab.

The display name is editable and searchable, while the original filename and a UUID tracking ID remain unchanged. One stored document may be linked to multiple maintenance records for the same vehicle. Editing links does not duplicate the file.

Photo rotation changes only SumpLog's presentation metadata. The original uploaded bytes remain available. Removing a document deletes the database record and stored file, including all of its maintenance links.

## Manage insurance

Insurance policies are independent garage records. A policy can cover no vehicles, one vehicle, or several vehicles, and different vehicles can use different policies. Add policy documents directly from Insurance. Deleting a vehicle unlinks it without deleting the policy or policy documents. Deleting the policy itself also deletes its attached policy documents.

## Use calculators

Calculators is below Specs in navigation and operates entirely in the browser; results are not saved.

- Fluid used by weight calculates mass difference and estimates volume using the selected or custom density.
- Torque converts among N·m, lb-ft, lb-in, and kgf·m.
- Fluid volume converts among mL, L, US fl oz, US qt, and US gal.
- Pressure converts among psi, kPa, and bar.
- Flooded-battery hydrometer corrects cell specific gravity for temperature, estimates state of charge, and flags a cell spread above 0.030.
- Coolant tester estimates freeze protection from glycol concentration or converts a reported freeze point.

Calculator results are aids, not substitutes for the vehicle, fluid, battery, coolant, or tool manufacturer's specifications.

## Export and restore

Settings provides four portability paths:

- **Export ZIP (Excel + files):** a human-readable `SumpLog.xlsx` workbook plus vehicle, service, project, insurance, and garage folders. Extract the complete ZIP before using workbook links.
- **Maintenance PDF:** from Maintenance, export one, several, or all filtered/selected records. Each record is kept with its evidence; PDF receipts precede other evidence for that record. The report uses a print-friendly white background with SumpLog typography and accent styling.
- **CSV summary:** a lightweight multi-section text export without binary attachments.
- **Full JSON backup:** a restorable snapshot containing records and base64-encoded stored assets.

JSON restore replaces the whole garage. SumpLog validates the file, shows record counts and warnings, requires the word `REPLACE`, and writes a pre-restore recovery backup before changing records. The upload limit for restore is 120 MB. For larger installations, stop the server and copy the full data directory instead.

## Change the owner password

When authentication is enabled, open Settings > Access. Enter the current password and a new password of at least 12 characters. Changing it invalidates other active sessions. The new password hash is stored in SQLite and takes precedence over the original `SUMPLOG_PASSWORD` environment value.
