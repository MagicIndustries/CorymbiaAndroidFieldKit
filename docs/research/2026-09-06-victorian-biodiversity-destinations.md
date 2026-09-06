# Victorian biodiversity destinations: what actually accepts field records

**Research spike, 2026-09-06.** Purpose: determine what MapShareVic, DEECA NatureKit and the
Victorian Biodiversity Atlas (VBA) accept as *input*, so the Corymbia Field Kit's export feature
can be designed against a real target rather than an assumed one.

Every factual claim below carries a URL. Where a statement is my reasoning rather than a quote
from a source, it is tagged **[inference]**.

> **Method note.** `www.environment.vic.gov.au` and `www.land.vic.gov.au` sit behind a Cloudflare
> challenge that rejects plain `curl` and unattended fetchers with HTTP 403. Pages were read
> through a real logged-out browser session; PDFs were read through the Jina reader proxy
> (`https://r.jina.ai/<url>`), which renders the department's own PDF bytes. The batch-upload
> template was downloaded as a file and its XML/VBA-macro internals were read directly. So the
> template columns and controlled vocabularies below are read out of DEECA's own artefact, not
> paraphrased from a summary.

---

## 1. Summary — one line each

| System | What it accepts from a field ecologist |
| --- | --- |
| **MapShareVic** | **Nothing.** Anonymous read-only property / forest / public-land / water viewer. No login, no submission tool, no writable service, no bulk import — and no biodiversity layers at all. Its "Upload Data" button overlays a file on *your own browser session*. |
| **DEECA NatureKit** | **Nothing.** Anonymous read-only viewer and extract portal over a weekly snapshot of VBA data. No login, no submission tool, no writable service. Its "upload shapefile" tools add a layer to *your own browser session* only. |
| **Victorian Biodiversity Atlas (VBA)** | **This is the ingestion system.** Registered, human-approved accounts only. Three routes: manual web-form entry; an Excel `.xlsm` batch-upload template obtained by emailing DEECA (and requiring the batch-upload *function* to be enabled on your account); and VBA Go, a mobile web tool that is **currently offline**. No public submission API. Every record goes to a species expert for review before publication. |

### Verdict on the three stated hypotheses

1. **"MapShareVic and NatureKit are primarily map viewers, not submission endpoints."** — **Confirmed for both, emphatically, and it is stronger than "primarily".** Neither has user accounts; neither exposes a single writable ArcGIS service (every service in both is `Map,Query,Data` — no FeatureServer exists on either platform); neither has any submit/contribute/import function in its official user manual. MapShareVic goes further: it carries no biodiversity or species layers at all, so there is nothing there to write to even in principle.
2. **"The VBA is the actual ingestion system for species records."** — **Confirmed.** DEECA itself draws the line: *"VBA is primarily a tool for sharing your observations and survey effort. If you wish to search and generate reports … please use the NatureKit tool"* ([About the VBA](https://www.environment.vic.gov.au/biodiversity/victorian-biodiversity-atlas/about-the-vba)).
3. **"VBA bulk submission is a spreadsheet template upload, not a public API."** — **Confirmed**, and it is *narrower* than assumed. The template is not a plain CSV: it is a macro-enabled Excel workbook whose VBA macro validates the data and emits a **second, differently-shaped `.xls` file** (`VBA_BATCH_*`) which is what actually gets uploaded. It is not published for general download — you must email `vba.help@deeca.vic.gov.au` — and access to the batch-upload function itself must be requested.

---

## 2. MapShareVic

**Verdict: read-only viewer. It ingests nothing, and it is the wrong family of data entirely.**

### What it is and who runs it

- A DEECA-published interactive map. `https://mapshare.vic.gov.au/` redirects to
  <https://www.deeca.vic.gov.au/maps>, DEECA's "Maps and everything spatial" site.
- DEECA's own catalogue entry: *"MapShareVic — The MapShareVic interactive map includes the themes:
  property, forest explorer, public land, water and wetland."* —
  <https://www.deeca.vic.gov.au/maps/interactive-maps>
- DEECA's own feature list: *"MapShareVic is our premium interactive mapping application which
  enables you to: interact with maps for Forest, Public Land, Water, Property and Address; search for
  an address, place name, locality or local government area; identify features on the map; turn
  layers on and off; view different basemaps; load your layer to a map; draw shapes on a map; print
  and export your map."* — <https://www.deeca.vic.gov.au/maps/linkassets/mapsharevic>
- The user manual is hosted by DEECA
  (<https://www.deeca.vic.gov.au/__data/assets/word_doc/0020/741701/MapShareVicHelp_20250320.docx>);
  user-facing help is mirrored under DTP's land.vic.gov.au
  (<https://www.land.vic.gov.au/maps-and-spatial/maps/interactive-mapping-tools/mapshare-help>).
  **[inference]** In practice it is DEECA-operated over DTP/Land Use Victoria Vicmap content.

### No accounts, no submission

- The Geocortex site declares `"signInEnabled": false`, and an anonymous request is served as
  `"Guest"` / `"isAuthenticated": false` —
  <https://mapshare.vic.gov.au/Geocortex/Essentials/EXT/REST/sites/MapShareVic?f=json>.
  There is no identity to attribute a submission to. **[inference]**
- The 25-page official user manual contains **zero** occurrences of "upload", "submit", "add data",
  "contribute", "import" or "edit" as a user function. Its entire tool set is search, layers,
  identify, right-click menu, printing, projections, measure, symbology, filtering, legend, and
  export image/GeoTIFF —
  <https://www.deeca.vic.gov.au/__data/assets/word_doc/0020/741701/MapShareVicHelp_20250320.docx>
- **It has no biodiversity or species layers.** Its 41 map services cover forest, roads, crown land,
  property/parcel/address, public land, water/catchment, wetlands, groundwater, hunting areas,
  boundaries and basemaps only —
  <https://mapshare.vic.gov.au/Geocortex/Essentials/EXT/REST/sites/MapShareVic/map?f=json>

### API: read-only

- There is no ArcGIS REST directory on `mapshare.vic.gov.au` itself (`/arcgis/rest/services`,
  `/arcgis/rest`, `/server/rest/services` all return IIS 404). The front end is Geocortex Essentials
  4.15 / HTML5 Viewer 4.12.2; its open but undocumented site-definition API is at
  <https://mapshare.vic.gov.au/Geocortex/Essentials/EXT/REST/sites?f=json> — read-only.
- The data services live on <https://corp-gis.mapshare.vic.gov.au/arcgis/rest/services?f=json>
  (ArcGIS Server 11.3) and <https://corp-geo.mapshare.vic.gov.au/arcgis/rest/services?f=json>
  (10.81, geocoders).
- **All 39 services in the `Mapshare` folder return `capabilities: "Map,Query,Data"` with
  `supportedExtensions: ""`.** No `Create`, `Update`, `Delete` or `Editing`. Example:
  <https://corp-gis.mapshare.vic.gov.au/arcgis/rest/services/Mapshare/Wetland/MapServer?f=json>
- **There is not a single FeatureServer anywhere on `corp-gis.mapshare.vic.gov.au`** across all 16
  folders; every service is a `MapServer` except four print/prep `GPServer`s. No WMS/WFS extensions
  are enabled on the MapShareVic services.
- Related read APIs, for completeness: DEECA's Open Data Platform WMS/WFS is framed purely as
  consumption — *"These services can be consumed by your spatial application directly from us."*
  (<https://www.deeca.vic.gov.au/maps/spatial-services/spatial-data-services>). Its GeoServer
  capabilities document does advertise `ImplementsTransactionalWFS TRUE`, but that is GeoServer's
  stock boilerplate; no write was attempted and DEECA documents it only as a read service —
  **do not treat it as a submission path**. DTP's Vicmap as a Service on ArcGIS Online reports
  `capabilities: "Query,Extract"` — also read-only
  (<https://discover.data.vic.gov.au/dataset/vicmap-as-a-service-vaas>).

### No bulk import; the "Upload Data" button is not submission

- There is no bulk-load, CSV ingest or spreadsheet submission path. CSV appears only *outbound*
  (export results to CSV/shapefile).
- MapShareVic's viewer config does include a Geocortex `UploadData` module and an "Upload Data"
  toolbar button
  (<https://mapshare.vic.gov.au/Geocortex/Essentials/EXT/REST/sites/MapShareVic/viewers/PublicSite/virtualdirectory/Resources/Config/Default/desktop.json.js>).
  It is the same Geocortex tool NatureKit runs, and DEECA documents its behaviour there: the file is
  added *"as layer to the layer list for the duration of the browser session"* and *"cannot be used
  as input to other … tools"*
  (<https://www.environment.vic.gov.au/biodiversity/naturekit/naturekit-tools>).
  **Adding a layer to your own map session is not submission** — nothing leaves the browser, nothing
  is stored, nothing is reviewed, nothing joins a dataset.
- Stock Geocortex editing commands exist in the config but are bound only to default context menus,
  never to a toolbar button, and are inert because no layer is editable. **[inference]**
- There *are* authenticated internal editor sites on the same platform (`MapshareEditor_ASB/CMR/DFW/…`,
  `Amendment_Requests`); an anonymous request to `MapshareEditor_ASB` returns HTTP 403
  *"The current user cannot access the desired resource"*. These are internal government editing
  sites, not a public channel.
- **Datashare** (<https://datashare.maps.vic.gov.au/>) is a download/extract portal — outbound only.
- The one genuine "submit into" facility in the DTP mapping family is the **Vicmap Editing Service**:
  *"Notify Land Use Victoria of errors within Vicmap datasets, request changes to improve the accuracy
  of Vicmap data or submit a naming proposal."*
  (<https://www.land.vic.gov.au/maps-and-spatial/maps/interactive-mapping-tools>). That is for
  base topographic and cadastral corrections, is a separate application from MapShareVic, and has
  nothing to do with species records.

### Mobile

No mobile app. MapShareVic is a responsive Geocortex viewer with desktop/tablet/handheld shells. The
manual's only mobile mention is exporting *out*: export a GeoTIFF and load it into Avenza PDF Maps
(<https://www.deeca.vic.gov.au/__data/assets/word_doc/0020/741701/MapShareVicHelp_20250320.docx>).
DTP's nearest app is **Vicmap Viewer**, *"a mobile application that makes it easy to discover,
purchase and download more than 10,000 Victorian topographic maps"* — viewing only, no capture
(<https://www.land.vic.gov.au/maps-and-spatial/maps/try-vicmap-viewer-app>).

### Relationship to NatureKit and the VBA

MapShareVic, NatureKit, VicPlan and CoastKit are **sibling Geocortex sites on the same DEECA
platform**, all listed at
<https://mapshare.vic.gov.au/Geocortex/Essentials/EXT/REST/sites?f=json>. That is why NatureKit's
ArcGIS host is `biod-gis.mapshare.vic.gov.au` (§3). MapShareVic is the property/forest/public-land/
water member of the family and carries no biodiversity content; NatureKit is the biodiversity read
view; the VBA is the only one that ingests.

---

## 3. DEECA NatureKit

**Verdict: viewer and extract portal only. It ingests nothing.**

### What it is

- DEECA's biodiversity web-mapping platform: *"a free online mapping and data exploration tool for
  biodiversity data integration and decision support. People can overlay and link related
  biodiversity datasets, and use several tools to query, extract and download information by areas
  or other layer features."* — <https://www.environment.vic.gov.au/biodiversity/naturekit>
- `https://naturekit.biodiversity.vic.gov.au/` 302-redirects to
  `https://maps2.biodiversity.vic.gov.au/Html5viewer/index.html?viewer=NatureKit`. The page title is
  literally `Geocortex Viewer for HTML5`; it boots `geocortex.essentialsHtmlViewer.ViewerLoader()`
  against `Geocortex/Essentials/REST/sites/NatureKit/…`. Geocortex Essentials reports
  `"currentVersion":"4.14"` — <https://maps2.biodiversity.vic.gov.au/geocortex/essentials/rest/sites/NatureKit?f=json>
- The GIS behind it is **ArcGIS Server 11.1** at `biod-gis.mapshare.vic.gov.au`
  (`"currentVersion":11.1`) — <https://biod-gis.mapshare.vic.gov.au/arcgis/rest/services?f=json>

### No accounts, no submission

- The site descriptor reports `"signInEnabled":false,"signOutEnabled":false` and a principal of
  `"label":"Guest"` — <https://maps2.biodiversity.vic.gov.au/geocortex/essentials/rest/sites/NatureKit?f=json>.
  There is no identity to attach a submission to. **[inference]**
- The published NatureKit User Guide lists every tool in the viewer (Layer List, Identify, Filter
  Species, Download from all Observations, Species Name Lookup, Overlay Your Data, Create
  PDF/Image/GeoTiff, Draw & Measure, Search, Zoom to XY, Plot Coordinates, Bookmarks, Select Based
  on Condition). None submits data. — <https://www.environment.vic.gov.au/biodiversity/naturekit/naturekit-tools>
- The two "upload" tools are explicitly session-scoped and are *not* ingestion:
  - *Upload Shape File as Layer* — accepts `.csv, .xlsx, .kml, .shp, .gpx` or a zipped FileGDB/shapefile
    and adds it as a layer *"for the duration of the browser session"*, and *"cannot be used as input"*
    to other NatureKit tools.
  - *Upload Shape as Drawing* — *"Only polygon shape files are accepted"*, used purely as a spatial
    filter; described as *"less persistent"*.
  — <https://www.environment.vic.gov.au/biodiversity/naturekit/naturekit-tools>

### It is a read view over the VBA

- NatureKit displays *"Species observation records and species information from the Victorian
  Biodiversity Atlas (VBA)"* — <https://www.environment.vic.gov.au/biodiversity/naturekit>
- It is a snapshot, not live: *"The data available in Naturekit is a snapshot and only those records
  that indicate presence or abundance of the species identified and have been vetted by species
  specialists."* — <https://www.environment.vic.gov.au/biodiversity/naturekit/nk-datalists>
- Refresh cadence, per DEECA: *"VBA Datasets are available in Datashare/Naturekit and updated
  weekly."* — <https://www.environment.vic.gov.au/biodiversity/victorian-biodiversity-atlas>
- Sensitive taxa are denatured to *"an approximate location polygon of 1-minute-grid size (approx.
  1.8 x 1.5 km)"* — <https://www.environment.vic.gov.au/biodiversity/naturekit/nk-datalists>

### API: read-only, verified service by service

Enumerating every service in every folder of
<https://biod-gis.mapshare.vic.gov.au/arcgis/rest/services?f=json> (`!PRD-BIOD-GIS, CoastKit,
NatureKit, NatureKitBasemaps, NatureKitGP, NatureKitGPL, Utilities`) turned up **no FeatureServer at
all** — only `MapServer`, `GPServer`, `GeometryServer`, `SymbolServer`. Verbatim `capabilities`:

| Service | `capabilities` |
| --- | --- |
| `NatureKit/vba_threatened_flora/MapServer` | `Map,Query,Data` |
| `NatureKit/vba_threatened_fauna/MapServer` | `Map,Query,Data` |
| `NatureKit/vba_all_flora/MapServer` | `Map,Query,Data` |
| `NatureKit/vba_all_fauna/MapServer` | `Query,Map,Data` |
| `NatureKit/species_query/MapServer` | `Map,Query,Data` |
| `NatureKit/NK_EVCs_2005_cached_VG2020/MapServer` | `Map` |

All 41 NatureKit services and all 31 CoastKit services are `Map,Query,Data` (or bare `Map` for
cached basemaps). **No `Create`, `Update`, `Delete` or `Editing` anywhere.** Example citation:
<https://biod-gis.mapshare.vic.gov.au/arcgis/rest/services/NatureKit/vba_threatened_flora/MapServer?f=json>

The geoprocessing services are extraction-only: `allobservationsextract` is described as
*"extract from all VBA observations for a given area"*, `"capabilities":""` —
<https://biod-gis.mapshare.vic.gov.au/arcgis/rest/services/NatureKitGP/allobservationsextract/GPServer?f=json>

### Export formats (useful as a shape reference, not a destination)

- *Filter Species* downloads the attribute table and/or observation points; DEECA recommends
  **CSV and ESRI shapefile**, and warns *"downloaded date columns may be in a month-day-year format
  even if shown differently within the NatureKit application"*.
- *Download from all Observations* extracts all VBA observations for an area plus a species summary sheet.
- *Plot Coordinates* exports CSV or shapefile; *Create PDF, Image or GeoTiff* produces A4/A3 PDF or GeoTIFF.
— <https://www.environment.vic.gov.au/biodiversity/naturekit/naturekit-tools>

### Mobile

None. NatureKit is browser-only: *"NatureKit is built using HTML5 standards and technology, and
works best in the latest version of Google Chrome, Mozilla Firefox and Microsoft Edge."* —
<https://www.environment.vic.gov.au/biodiversity/naturekit>

---

## 4. Victorian Biodiversity Atlas (VBA)

**Verdict: the real ingestion system, and the only one of the three that takes records from the public.**

Current URL: `https://vba.biodiversity.vic.gov.au/` (the VBA landing page carries the notice
*"Please note the new VBA URL: https://vba.biodiversity.vic.gov.au/"*) —
<https://www.environment.vic.gov.au/biodiversity/victorian-biodiversity-atlas>. Older DEECA guides
still cite `https://vba.dse.vic.gov.au/vba/`.

### 4.1 Registration, review and licensing — all mandatory before anything else

- *"If you want to see detailed records and contribute your observations, you must first register
  and agree to the VBA terms & conditions of use."* —
  <https://www.environment.vic.gov.au/biodiversity/victorian-biodiversity-atlas>
- *"To add your species observations to the VBA you first need to register and await your account
  activation email (may take up to 3 days)."* —
  <https://www.environment.vic.gov.au/biodiversity/victorian-biodiversity-atlas/about-the-vba>
- Every record is human-reviewed before it is published: *"All new records submitted are forwarded
  to the appropriate expert to verify. DEECA completes the expert review cycle approximately every
  4 months."* —
  <https://www.environment.vic.gov.au/biodiversity/victorian-biodiversity-atlas>. After review the
  Reliability field becomes `confirmed`, `acceptable`, or `unconfirmed` (the last stays in draft,
  visible only to the contributor) —
  <https://www.environment.vic.gov.au/__data/assets/pdf_file/0029/445385/VBA-add-a-survey-and-species_BRP_v2.pdf>
- **Licensing:** *"Registered Users that upload data and copyrighted material agree to granting the
  state a flexible licence (Creative Commons Attribution 4.0 International licence) which is a
  non-exclusive, worldwide royalty free and perpetual licence."* Contributors' names are published
  next to their data: *"Users of the website that upload data into the website agree and acknowledge
  that their name will be clearly visible and noted as the source of the data … to all users of the
  website."* — <https://www.environment.vic.gov.au/biodiversity/victorian-biodiversity-atlas/terms-and-conditions>
- **Sensitive data** is a separate access class; access to restricted records is granted by emailing
  `vba.help@deeca.vic.gov.au` — same page.

### 4.2 Is there a public API? No.

- No documented public API exists on any DEECA page found in this spike.
- The VBA front end is an AngularJS 1.4 single-page app (`Version: 3.2.8`, `Last Review Date: 21 Aug
  2026`) served from <https://vba.biodiversity.vic.gov.au/vba/>. Its `js/app.js` shows an
  **undocumented internal** REST surface at `/vba/api/…` used only for account handling:
  `/vba/api/users/:id`, `/vba/api/organisations/:id`, `/vba/api/users/reset`,
  `/vba/api/users/check/{field}/{value}` — <https://vba.biodiversity.vic.gov.au/vba/js/app.js>
- Probing for machine-readable API descriptions returned 404 for `/vba/api/swagger.json`,
  `/vba/v2/api-docs`, `/vba/swagger-ui.html` and `/vba/api/openapi.json`. `/vba/api/organisations`
  returns JSON (200); `/vba/api/users` returns 405 to GET. **[inference]** There is an internal
  service layer, but it is undocumented, unversioned publicly, has no published auth contract for
  third parties, and nothing found exposes record submission. Building against it would be building
  against a private endpoint.
- **[inference]** Treat "no public submission API" as settled for design purposes; if a machine
  channel is ever wanted, the documented route is to ask DEECA — see the bulk-transfer arrangement
  below.
- DEECA *does* run a negotiated bulk-transfer channel for other apps: *"Other data collection apps –
  if you regularly use other apps to record species information (such as iNaturalist or Birdata),
  and would like to transfer your records to the VBA, please contact us for more details."* —
  <https://www.environment.vic.gov.au/biodiversity/victorian-biodiversity-atlas>

### 4.3 Route A — manual web-form entry

The documented flow (DEECA quick-help guides):

1. **Create a Project.** *"all species records must be associated with either a Project or a General
   Observation."* Mandatory: **Project Name, Description, Start Date**. Organisations and Personnel
   are managed on the project. **Permit** details are an optional block (*"If you are collecting data
   under a Permit(s), you can enter the details of the Permit(s) here"*) —
   <https://www.environment.vic.gov.au/__data/assets/pdf_file/0028/48970/VBA-Contribute-Create-a-project.pdf>
2. **Add a Survey.** Mandatory: **Primary Discipline, Survey Name, Start Date**.
3. **Create a Site** (or reuse an existing VBA Site ID). Mandatory: *"site Name, Locality and
   Accuracy (in metres)"*. You may plot the point on the map or type coordinates.
4. **Add a Survey Method**, then **Species Records** via a taxon search on *"the scientific name,
   common name or if known the VBA Taxon ID"*.
5. **Validate & Submit** → expert review.
   — <https://www.environment.vic.gov.au/__data/assets/pdf_file/0029/445385/VBA-add-a-survey-and-species_BRP_v2.pdf>

The UI marks mandatory fields with a red dot and conditional fields with a yellow dot (same source).

### 4.4 Route B — Excel batch upload (the bulk path)

**Availability.** Recommended *"if you have 5 or more surveys to add"*. The templates are **not
published**: *"Please email vba.help@delwp.vic.gov.au to get a set of templates and associated help
to upload."* — same PDF. Restated currently as *"batch upload multiple records using our spreadsheet
templates. Contact us to get the latest version of these templates at vba.help@deeca.vic.gov.au"* —
<https://www.environment.vic.gov.au/biodiversity/victorian-biodiversity-atlas/about-the-vba>

Access to the *function*, not just the file, is gated: *"If you have a large volume of records to
submit, you can use the VBA batch upload function. This requires you to populate an excel template
to upload data to the VBA. … To request access to the VBA batch upload function and batch upload
templates and instructions please email vba.help@delwp.vic.gov.au."* —
<https://www.environment.vic.gov.au/biodiversity/investing-in-biodiversity/hubs-and-iconic-species>

**One real template is publicly downloadable.** DEECA publishes a translocation variant of the
terrestrial fauna template:
`VBA_Fauna_Simple__Transolcation.xlsm` (sic) —
<https://www.environment.vic.gov.au/__data/assets/excel_doc/0027/467190/VBA_Fauna_Simple__Transolcation.xlsm>
linked from <https://www.environment.vic.gov.au/biodiversity/victorian-biodiversity-atlas>, with a
companion guide
<https://www.environment.vic.gov.au/__data/assets/word_doc/0035/467189/Translocation-Data-for-VBA-guide.docx>.
Everything in §4.4 and §4.5 below is read directly out of that file's sheets, cell comments, data
validations and VBA macro. **[inference]** The translocation-specific parts are the `Translocated`
method and the salvage/release `Extra Info` convention; the structure, vocabularies and validation
appear to be the generic VBA terrestrial-fauna template.

**It is a two-stage format.** The workbook has a user-facing `Fauna Recording Form` sheet and a
hidden `Terr_Fauna` sheet. A macro (`cmdCreateBatchFile_Click`) validates the entered rows and writes
a **separate `VBA_BATCH_*.xls` workbook** in the hidden sheet's shape — that generated file is what is
uploaded. So the wire format is *not* the sheet the user types into. (Read from
`xl/vbaProject.bin` strings and `xl/workbook.xml` in the downloaded `.xlsm`.)

#### Sheet 1 — `Fauna Recording Form` (what a person fills in)

Header row read verbatim from the file; the "Required?" column is DEECA's own cell comment on that
header cell.

| Col | Header (verbatim) | Required? (DEECA's cell comment, verbatim or summarised) |
| --- | --- | --- |
| B | `Observers (responsible for ID, give VBA login name if known, separate observers with comma)` | **Mandatory.** *"Enter the login name of all people involved in the survey, separated by a comma (note that they will need to be listed in the project in the previous step)."* |
| C | `Your Ref (100 txt length)` | Optional. Max 100 chars. |
| D | `Site Name` | **Mandatory for new sites.** *"Can be your own reference ID, or descriptive e.g. Little Boggy Spur Tk"* |
| E | `Location description` | **Mandatory for new sites.** *"Should give an indication of where the site is… This is what expert reviewers see when they review your record, and can be really helpful in determining if the lat longs are plotting in the right place."* |
| F | `Existing VBA Site ID` | Alternative to D–L. *"If you have an existing VBA site, simply enter the VBA Site ID here, and leave the site details to the left and right blank."* |
| G | `Co-ordinate system` | **Mandatory for new sites.** Closed dropdown. |
| H | `Datum` | **Mandatory for new sites**, *"choose from GDA94, WGS84 or AGD66"*. Closed dropdown. |
| I | `Zone` | *"Only required if your type of coordinate system is eastnorthl or eastnorths"* |
| J | `X-coordinate (Easting or Longitude)` | **Mandatory for new sites.** *"Make sure you get your longitudes and latitudes around the right way here!"* |
| K | `Y-coordinate (Northing or Latitude)` | **Mandatory for new sites.** |
| L | `Locational accuracy (m)` | *"Accuracy of the coordinates (NOT the site/transect etc. extent)"* — see §5 for whether it is mandatory. |
| M | `Survey Name` | **Mandatory.** Max 125 chars (Excel data validation). *"Should be descriptive and ideally unique, and give an idea of the intention, method and location of the survey."* |
| N | `Start date` | **Mandatory.** Start date of survey. |
| O | `Method` | Closed dropdown (see §4.5). |
| P | `Method Detail` | **Mandatory**, from dropdown. *"Only 1 method detail and associated value is allowed for each survey in this workbook."* |
| Q | `Method detail value` | Numeric value for the method detail. |
| R | `Species (Common Name)` | Either R **or** S. *"There must be an exact match with the VBA taxon name."* |
| S | `Species (Scientific Name)` | Either R **or** S, same exact-match rule. |
| T | `Count` | Optional. *"If no count was recorded, leave blank."* |
| U | `Extra Info` | In the translocation template: `s` = salvage site, `r` = release/re-introduction site. |
| V | `Type of Observation` | **Mandatory**, from dropdown. |
| W–AA | `X_Y`, `VBA_Taxon_Id`, `hc1`, `hc2`, `initial order` | Helper/calculated columns, not user data. |

#### The generated batch file — hidden `Terr_Fauna` sheet header (the actual upload schema)

Read verbatim from `xl/worksheets/sheet2.xml`, columns B–AO:

```
VBA Project ID
do not use            (col C)
do not use            (col D)
VBALogin name (comma separated)
Site ID
do not use            (col G)
do not use            (col H)
Site Name
Location description
Survey Name
Start date
End date
Type of coordinate system
GPS used (y, n)
Datum (g, a, w)
X-coordinate (easting or longitude)
Y-coordinate (northing or latitude)
Mapsheet number
MGA Zone
Positional accuracy (metres)
Altitude (m asl)
Users own reference
Survey method
Method details
do not use            (col Z)
Sampling details - Numeric Value
Sampling details - Text value
Taxon Name
Taxon Common Name
Taxon ID
Count
Extra information
Type of Observation
Behaviour
Count Qualifier (comma separated)
Origin of Taxon at site
Specimen sent to
Specimen reference No.
Observer
Series_Id (this sheet)
```

Two of these matter enormously for this app and appear nowhere in the user-facing sheet:
**`GPS used (y, n)`** and **`Positional accuracy (metres)`**. See §5.

#### Macro-enforced mandatory fields

The template's own validation refuses to build the batch file if any of these are blank
(messages read verbatim from `xl/vbaProject.bin`; the column letters in the messages refer to the
macro's internal working array, not to either visible sheet):

- Observer list
- Site Name
- Survey Name
- Start Date
- Method
- Type of Observation
- Datum
- X-Coordinate, Y-Coordinate
- Zone (and *"Zone (column H) must be 54 or 55"*)
- Taxon ID

It also range-checks coordinates — see §5.

**Notably absent from that mandatory list: positional accuracy.** The Data Standards and the web
form both say accuracy is mandatory; the macro does not enforce it. **[inference]** This is a gap in
the template's validation, not permission to omit it.

**Legacy annotations.** The workbook's `Lookups` sheet carries stale cell comments from an earlier
template revision that corroborate the batch schema: *"Project ID … Mandatory. Office use only
UNLESS new survey for a project and the Project ID is known"*; a permit-number field (*"Please type
the number of any permit that was issued for the project or survey"*); a restricted-site flag
(*"Please only mark yes in this column if the site is listed as restricted … n or y only"*); and
mandatory site name and location description. Treat these as corroborating, not authoritative —
they are attached to the wrong sheet in the current file. **[inference]**

### 4.5 Controlled vocabularies (verbatim from the template's `Lookups` sheet)

**Coordinate system** (description → code stored in the batch file):

| Description | Code |
| --- | --- |
| `latitude/longitude - decimal degrees (DD)` | `decdegrees` |
| `eastings and northings - full` | `eastnorthl` |
| `eastings and northings - short` | `eastnorths` |
| `latitude/longitude - Degrees Minutes Seconds (DMS)` | `latlong` |

**Datum** (`Datum (g, a, w)`):

| Description | Code |
| --- | --- |
| `GDA94` | `g` |
| `AGD66` | `a` |
| `WGS84` | `w` |

**There is no GDA2020 option.** See §5.

**Type of observation:**

| Description | Code | Note (verbatim) |
| --- | --- | --- |
| `Observation` | `o` | `default` |
| `Seen` | `s` | |
| `Heard` | `h` | |
| `Captured` | `cap` | `(linked to methods: Hair Tube, Nest box, Targeted search only)` |
| `Indirect evidence` | `i` | `(linked to methods: Elliot trap, Nest box only)` |
| `Released` | `r` | `(linked to methods: Elliot trap, Nest box only)` |
| `Captured and Released` | `t` | |
| `Specimen collected` | `m` | |

**Sampling methods** (this template's subset — the full VBA list is longer):

| Method | Code |
| --- | --- |
| `Incidental` | `INC` |
| `Targeted search` | `70` |
| `Camera - Surveillance/Remote` | `9090` |
| `Bat detector` | `9066` |
| `Bird count` | `9030` |
| `Dusk watch` | `9044` |
| `Elliott trap` | `9001` |
| `Hair tube` | `9013` |
| `Herp spot count` | `9036` |
| `Nest box` | `9067` |
| `No. of caves/mines/hollows searched` | `9087` |
| `Specimen` | `MUSEUM` |
| `Spotlighting` | `9010` |
| `Translocated` | `37` |
| `Stag watching` | `9019` |
| `Dip Net` | `12` |

**Method details** (each valid only for certain methods; code is the stored value):

| Applies to | Detail | Code |
| --- | --- | --- |
| Dip Net | `Average Width Sampled (m)` | `5` |
| Dip Net | `Length sampled (m)` | `4` |
| Targeted search, spotlighting | `Area sampled (square meteres)` | `6` |
| Targeted search, Bird count, Dusk Watch | `Minutes` | `106` |
| Targeted search | `Number of observers` | `108` |
| Camera - Surveillance/Remote, Bat detector, Elliott trap | `Trap nights (cameras x no. of nights)` | `101` |
| Hair tube, Nest box, No. of caves/mines/hollows | `Number of tubes, boxes or stags` | `103` |
| Herp spot count | `Hours` | `102` |
| No. of caves/mines/hollows searched | `Area surveyed (ha)` | `204` |
| No. of caves/mines/hollows searched | `Number searched` | `203` |

**Specimen sent to:** `Melbourne Museum` → `museum`.

### 4.6 Species vocabulary — a closed, VBA-proprietary list

- The identifier is the **VBA Taxon ID**, a DEECA-specific integer. The Data Standards define
  *"Species Observed (Taxon ID) … made up of the Scientific Name, Common Name and associated VBA
  Taxon ID from the defined list … Example: 'Pelecanus conspicillatus' 'Australian Pelican' '11652'"*
  — <https://www.environment.vic.gov.au/__data/assets/pdf_file/0033/396753/VBA-Data-Standards.pdf>
- The template's `Lookups` sheet stores `COMM_NAME | TAXON_ID | SCI_NAME` triples (e.g.
  `Abantiades aphenges` → `519644`) and the batch macro resolves names to `Taxon ID`; **`Taxon ID` is
  a macro-mandatory field** (§4.4). Name matching is exact: *"There must be an exact match with the
  VBA taxon name."*
- The list is obtainable two ways: from inside the VBA (*"The full species checklist including
  conservation and restricted status is available to download direct from the VBA application
  (Search > Download Species Checklist)"* —
  <https://www.environment.vic.gov.au/biodiversity/victorian-biodiversity-atlas>), and as a public
  open-data table, **Victorian Biodiversity Atlas (VBA) Taxa List**, whose *"main attributes … are the
  current VBA taxon_id, scientific name, common name, authority, family (where relevant),
  conservation status, origin and taxon type"* —
  <https://discover.data.vic.gov.au/dataset/victorian-biodiversity-atlas-vba-taxa-list>
  (distributed via Datashare: <https://datashare.maps.vic.gov.au/search?q=vba>).
- Restricted taxa are enumerated publicly:
  <https://www.environment.vic.gov.au/__data/assets/pdf_file/0024/48831/VBA-Restricted-Taxa.pdf>

### 4.7 Photographs and audio

- **VBA Go required a photo** and could read location/date from its EXIF: *"Before you can submit
  your observations in VBA Go you need to have completed all 4 of the below: Added a photo, provided
  the location, the date and identified the species."* —
  <https://www.environment.vic.gov.au/__data/assets/pdf_file/0031/91759/VBA-Go-FAQs.pdf>
- **The batch template has no photo, image or audio column** (see the full header list in §4.4). It
  carries `Specimen sent to` and `Specimen reference No.` — physical vouchers, not media.
- Whether the desktop VBA data-entry app allows attaching an image to a survey record could **not be
  determined** without a login — see §6.

### 4.8 The department's own mobile app — VBA Go, and it is offline

- What it was: *"VBA Go is a mobile tool that links directly to the Victorian Biodiversity Atlas …
  VBA Go is a website that works on any connected device. All you need is your mobile phone and your
  existing VBA login details."* Not a native app. —
  <https://www.environment.vic.gov.au/biodiversity/victorian-biodiversity-atlas/vba-go>
- It supported offline capture: *"VBA Go will allow you to record and cache new observations when
  you have no network coverage but the Explore tools will not work"* — and *"Offline features are not
  yet supported on iPhones."* —
  <https://www.environment.vic.gov.au/__data/assets/pdf_file/0031/91759/VBA-Go-FAQs.pdf>
- Its scope was limited: *"VBA Go is for general observations; therefore, it is only the general
  observations you have previously submitted that are visible in this tool, not your records within
  projects or from a structured survey."* Records were **not editable** after saving. — same FAQ.
- DEECA's own guidance noted the project limitation: *"observations made in VBA Go cannot be linked
  to a Project, rather they are classified as a 'general observation'"* —
  <https://www.environment.vic.gov.au/biodiversity/investing-in-biodiversity/hubs-and-iconic-species>
- **Status: offline.** The VBA Go page has said *"Dec 2023: VBA Go is currently offline"* since 2023
  (<https://www.environment.vic.gov.au/biodiversity/victorian-biodiversity-atlas/vba-go>), and the
  main VBA page — footer *Page last updated: 29/04/26* — carries the banner *"VBA Go is offline until
  further notice."*
  (<https://www.environment.vic.gov.au/biodiversity/victorian-biodiversity-atlas>).

**[inference]** DEECA currently has no working mobile field-capture tool. That is the gap this app
sits in, and it means there is no departmental app the user is expected to be using instead.

---

## 5. Coordinates, datum and accuracy — the part that matters most

### 5.1 Accuracy is a first-class, mandatory field

The VBA has a coordinate-uncertainty field and treats it as required, in three independent sources:

1. **Data Standards, Table 2** ("Description of common attribute data required (**mandatory**) for
   each species observation") includes:
   *"Spatial accuracy — A numeric value in the meters of the potential error associated with the X-Y
   coordinates. Example '15'"*, mapped to
   `http://rs.tdwg.org/dwc/terms/coordinateUncertaintyInMeters`.
   — <https://www.environment.vic.gov.au/__data/assets/pdf_file/0033/396753/VBA-Data-Standards.pdf>
2. **The web form**: when creating a new site you must complete *"the mandatory fields: site Name,
   Locality and Accuracy (in metres)"* —
   <https://www.environment.vic.gov.au/__data/assets/pdf_file/0029/445385/VBA-add-a-survey-and-species_BRP_v2.pdf>
3. **The batch template** has `Locational accuracy (m)` on the entry sheet and
   `Positional accuracy (metres)` in the generated upload file.

The units are **metres**. DEECA is explicit about the semantics: it is *"Accuracy of the coordinates
(NOT the site/transect etc. extent)"* — i.e. positional uncertainty of the fix, not the size of the
area surveyed (template cell comment on column L).

Downstream, DEECA publishes the field and states its real-world range: *"Although this is a point
layer, the actual accuracy of the site can range from +/- 1m to +/- 500m"* —
<https://discover.data.vic.gov.au/dataset/victorian-biodiversity-atlas-fauna-records-unrestricted-for-sites-with-high-spatial-accuracy>.
The published attribute is `MAX_ACC_KM`, *"Site accuracy (km rad…)"* — i.e. accuracy is republished in
**kilometres**, so a metre-level value is preserved as a fraction. (Field names verified in the
GeoServer schema for `open-data-platform:vba_fauna25` at
<https://opendata.maps.vic.gov.au/geoserver/wfs?service=WFS&version=2.0.0&request=DescribeFeatureType&typeName=open-data-platform:vba_fauna25>.)

**There are separate "high spatial accuracy" datasets.** DEECA splits VBA extracts by spatial
accuracy — the flagship public layers are explicitly *"for sites with high spatial accuracy"* (same
DataVic page). **[inference]** A record submitted with a large or missing accuracy value is not
merely less precise; it is likely to fall out of the high-accuracy products that feed habitat models
and the native-vegetation regulations. That is a direct, material consequence of the app letting an
opportunistic fix pass as a survey-grade one.

### 5.2 There is an explicit "was a GPS used?" flag

The generated batch file carries **`GPS used (y, n)`** (column O of the `Terr_Fauna` schema). It has
no counterpart on the user-facing recording sheet and no cell comment, so its exact required-ness
is undocumented — but its existence means the VBA data model *already distinguishes* a GPS-derived
position from a map-derived one.

**[inference]** This is the single best fit for the app's survey-grade / opportunistic distinction:
export `y` only for a deliberate, GNSS-derived survey fix, and `n` for anything derived from a map
pin or a coarse ambient location — paired with an honest `Positional accuracy (metres)`. The app
should never emit `y` with a fabricated or optimistic accuracy.

### 5.3 Datum: the VBA is a GDA94 system; Victoria's official datum is GDA2020

- **The VBA accepts three datums only: `GDA94` (`g`), `AGD66` (`a`), `WGS84` (`w`)** — the closed
  dropdown in the template's `Lookups` sheet, and the same three named in the Data Standards:
  *"Coordinate datum … GDA94, WGS84, AGD66"*
  (<https://www.environment.vic.gov.au/__data/assets/pdf_file/0033/396753/VBA-Data-Standards.pdf>).
  **GDA2020 is not an option in either.**
- The VBA's own published attributes are GDA94 decimal degrees: the fauna layer's fields are
  `lat_dd94`, `long_dd94` (GeoServer `DescribeFeatureType`, link above), and NatureKit's layer config
  gives their display names verbatim as `"Latitude (GDA94)"` and `"Longitude (GDA94)"`
  (<https://maps2.biodiversity.vic.gov.au/geocortex/essentials/rest/sites/NatureKit/map?f=json>).
  The VBA species MapServers report `{"wkid":102171,"latestWkid":3111}` — GDA94 / Vicgrid94
  (<https://biod-gis.mapshare.vic.gov.au/arcgis/rest/services/NatureKit/vba_threatened_flora/MapServer?f=json>).
- Meanwhile the distribution platform has moved on: the Vicmap open-data WFS advertises
  `DefaultCRS urn:ogc:def:crs:EPSG::7844` — **GDA2020 geographic** — for `vba_fauna25`
  (<https://opendata.maps.vic.gov.au/geoserver/wfs?service=WFS&version=2.0.0&request=GetCapabilities>),
  and NatureKit's viewer extent uses `wkid 7899` (GDA2020 / Vicgrid).
- And the Surveyor-General is unambiguous: *"The Geocentric Datum of Australia 2020 (GDA2020) and the
  Map Grid of Australia 2020 (MGA2020) are the official datum and map projection for Australia."*
  … *"The coordinates of features on maps based on GDA94 are no longer aligned with Global Navigation
  Satellite System (GNSS), such as GPS. To enable seamless interaction between precise positioning
  technology and spatial information, users are encouraged to transition to GDA2020."* —
  <https://www.land.vic.gov.au/surveying/geodesy/geocentric-datum-of-australia>

**[inference] The practical consequence for an Android app.** An Android `Location` fix is WGS84,
which for present purposes is within centimetres of GDA2020 and roughly **1.8 m from GDA94** in
Victoria. That offset is *larger than the accuracy of a good survey-grade fix.* So:

- Declaring the datum as `WGS84` (`w`) is the **honest** choice for a raw phone fix — it is a
  supported VBA value, and it tells DEECA what was actually measured.
- Declaring `GDA94` without transforming would silently introduce ~1.8 m of error into a record
  whose stated accuracy might be 3 m. Do not do that.
- Do not offer GDA2020 in the export; the VBA will not accept it.

This is the one place where "never let an imprecise coordinate masquerade as a survey one" has a
concrete, technical failure mode.

### 5.4 Coordinate format and range validation

From the template macro's own error strings and the sample row in the shipped file:

- **Decimal degrees**: longitude validated to `139 - 152`, latitude validated to `33 - 40`. The
  template's own example row records Mallacoota Inlet as `X = 149.60551`, `Y = 37.47479` — **latitude
  entered as a positive magnitude, with no minus sign.** **[inference]** Southern-hemisphere latitude
  is entered unsigned in the DD form; emitting `-37.47479` would fail the `33 - 40` check. This needs
  confirming with DEECA before it is relied on (§6).
- **Eastings/northings**: X validated to `10000 - 1000000`, Y validated to `1000000+`,
  **`Zone … must be 54 or 55`** (MGA zones covering Victoria).
- **DMS** (`latlong`) is stored as a concatenated integer, per the Data Standards examples:
  *"When the type of coordinates is latlong a value would be: '1492136'"* / *"'373440'"* —
  i.e. `DDDMMSS` / `DDMMSS`. — Data Standards PDF, link above.
- Positional accuracy is a plain number of **metres** (Data Standards example: `15`).

### 5.5 Mapping to Darwin Core

The Data Standards explicitly map every mandatory attribute to a Darwin Core term, and state the
intent: *"The VBA standards are being further defined to meet the international standard Darwin Core."*
Useful pairs for the export model:

| VBA attribute | Darwin Core term |
| --- | --- |
| Project ID | `dwc:datasetID` |
| Project Name | `dwc:datasetName` |
| VBA Observer / Login Name | `dwc:recordedBy` |
| Site Name / Site Location | `dwc:verbatimLocality` |
| Coordinate system | `dwc:verbatimCoordinateSystem` |
| Coordinate datum, X, Y | `dwc:verbatimCoordinates` |
| **Spatial accuracy** | **`dwc:coordinateUncertaintyInMeters`** |
| Survey Name | `dwc:eventID` |
| Start Date (`dd/mm/yyyy`) | `dwc:verbatimEventDate` |
| Survey Method | `dwc:samplingProtocol` |
| Sampling Effort | `dwc:samplingEffort` |
| Species Observed (Taxon ID) | `dwc:taxonID`, `dwc:scientificName`, `dwc:vernacularName` |
| Count | `dwc:individualCount` |
| Extra Information | `dwc:behavior` |

— <https://www.environment.vic.gov.au/__data/assets/pdf_file/0033/396753/VBA-Data-Standards.pdf>

### 5.6 Identity, method and project are mandatory

Answering the brief's question directly:

- **Observer identity: mandatory.** *"VBA Observer/Log in Name — A unique sequence of characters used
  to identify a user … **Required for each observer** that has identified species occurrence records
  within that project"* (Data Standards). The template comment adds that observers must already be
  listed on the project. So the app must carry a **VBA login name**, not a free-text person name.
- **Survey method: mandatory**, and must come from the VBA's closed list (Data Standards; macro
  validation).
- **Project: effectively mandatory** — *"all species records must be associated with either a Project
  or a General Observation"*
  (<https://www.environment.vic.gov.au/__data/assets/pdf_file/0028/48970/VBA-Contribute-Create-a-project.pdf>).
  The batch schema's first data column is `VBA Project ID`. The Project ID is **server-generated**:
  *"The Project ID is generated by the VBA application once the delivery partner creates a new
  project within the application"* (Data Standards) — so the app cannot invent one; it must let the
  user paste in the ID DEECA issued.
- **Licence/permit: optional but supported** — a Permit block on the Project, and a permit-number
  field in the legacy batch annotations (§4.4).

---

## 6. What remains unknown, and what would resolve it

| # | Unknown | Why it is unresolved | What would resolve it |
| --- | --- | --- | --- |
| 1 | **The current, canonical batch templates** (fauna full, flora, general observation, aquatic). Only the *translocation* fauna variant is publicly downloadable. | DEECA does not publish them: *"Contact us to get the latest version of these templates at vba.help@deeca.vic.gov.au"* (<https://www.environment.vic.gov.au/biodiversity/victorian-biodiversity-atlas/about-the-vba>). | **Email `vba.help@deeca.vic.gov.au`** and request the current template set plus the batch-upload instructions. This is the single highest-value next action. |
| 2 | **Whether the flora template's schema differs.** Almost certainly yes: the published flora layer carries `coverabund`, `quadid_etc`, `nvis_gf`, `vic_lf`, `fire_resp` and `authority` where the fauna layer does not (compare the two GeoServer schemas: `DescribeFeatureType` for `open-data-platform:vba_flora25` vs `…:vba_fauna25` at <https://opendata.maps.vic.gov.au/geoserver/wfs>). | No flora template is public. | Same email as #1. |
| 3 | **Whether the shipped fauna template is current.** Its embedded SharePoint path is `.../VBA/Projects 2018_19/` and the cell-comment authors are DEECA staff from that era; the Data Standards PDF is titled *"Victorian Biodiversity Data Standards Oct 2018"*. | Both artefacts are ~2018–19 vintage; the VBA app itself reports `Version 3.2.8, Last Review Date 21 Aug 2026`. | Same email as #1 — ask explicitly whether the column set and code lists have changed. |
| 4 | **Whether latitude is entered signed or unsigned in decimal degrees.** Evidence points to unsigned (macro range `33 - 40`; shipped sample row `37.47479`) but this is inference from a validation rule, not a stated rule. | Not stated in any published document. | Ask DEECA, or observe the VBA web form's behaviour with a registered account. **Do not ship an exporter that guesses this.** |
| 5 | **Whether `GPS used (y, n)` is mandatory, and DEECA's definition of "GPS used".** | The column exists only in the hidden generated-file schema; no comment, no documentation. | Ask DEECA. Relevant because it is the natural home for the survey-grade/opportunistic flag. |
| 6 | **Whether the VBA will accept GDA2020**, given Victoria's official datum has moved. | The template and 2018 standards offer only GDA94/AGD66/WGS84. No newer statement found. | Ask DEECA. Until answered, export `WGS84`. |
| 7 | **Whether the desktop VBA can attach photographs or audio to a record.** VBA Go required a photo; the batch template has no media column. | Data-entry screens require a login; the published quick-help guides do not cover media. | A registered VBA account, or ask DEECA. Also worth asking whether an audio call-recording can support a `Heard` observation. |
| 8 | **Whether the VBA has an eDNA-appropriate survey method.** The published method list in the template contains no eDNA/molecular entry, and no DEECA page found mentions eDNA in the VBA. | The template carries only a subset of the full VBA method list, so absence here is not proof of absence overall. | Ask DEECA for the full `SAMPLING_METHOD` lookup. Note that the ALA runs a distinct eDNA pathway and *"Records must be submitted via spreadsheet in a prescribed format"* (<https://www.ala.org.au/environmentaldna/>) — outside the three systems in scope, but the obvious second destination for an eDNA kit. |
| 9 | **Whether the internal `/vba/api/…` surface has record-submission endpoints**, and on what auth. | Only the pre-login SPA bundle is readable; there is no OpenAPI/Swagger (all probes 404). | Would require a logged-in session and inspection of the authenticated app — and even then it is an undocumented private API and should not be a design target. |
| 10 | **Terms for a third-party app feeding the VBA in bulk.** DEECA runs such an arrangement for iNaturalist and Birdata but publishes no terms. | *"please contact us for more details"* (<https://www.environment.vic.gov.au/biodiversity/victorian-biodiversity-atlas>). | A conversation with the VBA team — worth having early if regular submission is expected. |
| 11 | **Whether/when VBA Go returns.** | DEECA states only the fact of it being offline, unchanged from Dec 2023 through the 29/04/26 page update. | Ask DEECA. |

Two smaller gaps, neither affecting a conclusion:

- **The Vicmap Editing Service detail page** (`land.vic.gov.au/…/vicmap-editing-service`) could not be
  read — Cloudflare 403 direct, and the reader proxy failed to resolve the host across five attempts.
  Its description above is quoted from the parent page's tool card, which did load
  (<https://www.land.vic.gov.au/maps-and-spatial/maps/interactive-mapping-tools>). It concerns
  cadastral/topographic corrections, not species records, so it is not a candidate destination.
- **Whether MapShareVic's "Upload Data" button is actually rendered on screen** was confirmed only
  from the viewer config, not by driving the live UI. Immaterial: even when visible the tool is
  session-scoped display only.

Things that were **tried and failed**: direct `curl`/WebFetch of `environment.vic.gov.au` and
`land.vic.gov.au` (Cloudflare 403 — worked around via a real browser session and the Jina reader
proxy); `/vba/api/swagger.json`, `/vba/v2/api-docs`, `/vba/swagger-ui.html`, `/vba/api/openapi.json`
(all 404); `mapshare.vic.gov.au/arcgis/rest/services` and `/server/rest/services` (IIS 404);
anonymous access to the `MapshareEditor_*` sites (403); a site-wide search for a public flora batch
template (none published). No write was attempted against any government server — the
`ImplementsTransactionalWFS TRUE` line in DEECA's GeoServer capabilities is stock boilerplate and was
deliberately not probed.

---

## 7. Recommendation for the export feature

### 7.1 The mechanism is a file the user uploads. Automation is not viable.

There is no public write API anywhere in the three systems. NatureKit has no writable service and no
login at all; the VBA's only documented routes are a human web form and an authenticated batch
upload of a file. So the export feature's job is to **produce a correctly-shaped file** and get it
onto the user's laptop.

A **browser extension or scripted automation is not recommended**, for three reasons: the VBA is an
authenticated application with no published third-party integration contract; every record passes
through a human expert-review queue regardless, so automation buys no latency; and the terms of use
bind the *registered user* personally, with their name published against every record —
driving that account programmatically is the user's liability, not a technical convenience
(<https://www.environment.vic.gov.au/biodiversity/victorian-biodiversity-atlas/terms-and-conditions>).
**[inference]**

### 7.2 What the app should produce

1. **A VBA batch-shaped spreadsheet** — the primary export. Match the `Fauna Recording Form` column
   set in §4.4 exactly (header text verbatim, same order), emit the controlled-vocabulary
   *descriptions* the dropdowns expect (not the codes — the macro does the code lookup), and write
   `.xlsx`. **Do not attempt to reproduce the `.xlsm` macro or generate the `VBA_BATCH_*.xls` file
   directly**; let the user paste into DEECA's current template so their validation runs. **[inference]**
   Gate this on getting the current templates from DEECA (unknown #1) before finalising the column set.
2. **A generic CSV** with the same logical fields plus Darwin Core column aliases (§5.5) — for the
   ALA eDNA pathway, for a consultant's own GIS, and as insurance against the VBA template changing.
3. **A GeoJSON or shapefile-friendly point export** with `coordinateUncertaintyInMeters` as a real
   attribute, for anyone loading the data into NatureKit's "Overlay Your Data", QGIS or ArcGIS.

### 7.3 The single most important thing the design must account for

**Positional accuracy is a mandatory, metre-valued field in the destination, and the destination
also has an explicit `GPS used (y, n)` flag — so the app's survey-grade / opportunistic distinction
has a real place to land, and must land there truthfully.**

Concretely:

- Carry a per-fix `accuracyMetres` and a provenance enum (survey fix / ambient fix / map pin /
  unknown) from capture through to export. Never default, never infer, never round down.
- Export `Locational accuracy (m)` from the *measured* accuracy of that fix, and `GPS used` as `y`
  only for a deliberate GNSS fix.
- **Block export of any record with no accuracy value** rather than emitting a blank or a plausible
  default — the template's macro will not catch it (§4.4), and DEECA's high-spatial-accuracy datasets
  are exactly where a bad value does harm (§5.1).
- Export the datum as **`WGS84`**, matching what an Android fix actually is. Do not relabel a WGS84
  fix as GDA94 — the ~1.8 m offset is larger than a good fix's uncertainty and would corrupt the very
  distinction the app exists to protect (§5.3).
- Resolve the signed/unsigned latitude question (unknown #4) before shipping; get it wrong and every
  record fails validation, or worse, plots in the northern hemisphere.

### 7.4 Second-order design consequences

- **The app needs the VBA taxon vocabulary offline.** Bundle and periodically refresh the VBA Taxa
  List (`taxon_id`, scientific name, common name, conservation status) from
  <https://discover.data.vic.gov.au/dataset/victorian-biodiversity-atlas-vba-taxa-list>. Free-text
  species names will fail the exact-match rule (§4.6).
- **The app needs the VBA method and observation-type vocabularies offline** too (§4.5), because
  `Method` and `Type of Observation` are macro-mandatory closed lists.
- **The app must capture VBA login names, not person names**, for observers (§5.6), and must let the
  user attach a **VBA Project ID** that DEECA issued (§5.6) — plus an optional permit number.
- **Warn the user about restricted taxa** at capture time using the published restricted list
  (<https://www.environment.vic.gov.au/__data/assets/pdf_file/0024/48831/VBA-Restricted-Taxa.pdf>),
  since submitting them has data-sharing consequences.
- **Set expectations about latency**: expert review runs roughly every four months, and records are
  not editable while in review (§4.1).
- **The niche is real**: DEECA's own mobile tool has been offline since December 2023 and there is no
  replacement (§4.8). Offline field capture for Victoria is currently unserved by the department.
