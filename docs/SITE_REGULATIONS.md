# Preliminary Site Regulation Memo

## Site identity

- Map / street address used for the study: **3-12-2 Sotokanda, Chiyoda-ku, Tokyo 101-0021**
- Survey title-block parcels supplied by the project owner: **Sotokanda 3-chome, lots 91-2 and 91-3**
- Surveyed site area: **92.34 m²**
- Surveyed frontage: approximately **5.997 m**
- Surveyed depth: approximately **15.437 m**
- Surveyed front road: approximately **7.970 m wide**, marked as Building Standards Act Article 42(1)(1), Chiyoda special-ward road No. 669

The street address is the authoritative map-search location for this prototype. Parcel numbers are supporting evidence. A licensed designer should reconcile the current registry, road ledger, boundary confirmation, and Chiyoda planning portal before using these values for an application.

## Most likely envelope inputs

| Input | Preliminary value | Status |
|---|---:|---|
| Use zone | Commercial zone | Read from Chiyoda's official planning map; confirm by portal query |
| Designated building coverage ratio | 80% | Official planning-map reading |
| Fire designation | Fire prevention district | Official planning-map reading |
| Designated floor-area ratio | 600% | Official planning-map and district-plan reading |
| District plan | Sotokanda 2- and 3-chome District Plan | Confirmed for the surrounding area |
| District-plan subarea | Most likely **B district** | Map-based inference; confirm the exact parcel in the portal |
| District-plan minimum lot area | 50 m² | Site area of 92.34 m² exceeds it |
| District-plan minimum FAR | 160%, subject to listed use exceptions | Applies if the parcel is in the regulated subarea |
| District-plan height cap | Most likely 45 m | B-district rule; road-only reductions do not appear to apply because the surveyed road is 7.970 m |
| District-plan wall line | Likely 0.5 m along the front road | Map-based inference; this must be confirmed before calculation |
| District-plan greening rule | Not triggered at 92.34 m² | District-plan threshold is 500 m² |
| Chiyoda greening-plan filing | Not triggered at 92.34 m² | Private-site threshold is 250 m² |
| Article 42(2) road setback | Not indicated | Survey identifies an Article 42(1)(1) road wider than 4 m; verify the current road ledger |

## Floor-area ratio calculation

For a commercial-zone site with a front road under 12 m, the ordinary road-width FAR cap is:

`front road width × 0.6 × 100`

Using the survey width:

`7.970 × 0.6 × 100 = 478.2%`

Therefore, **478.2% is the preliminary base FAR**, even though the designated FAR is 600%.

If the parcel is B district, the wall line is confirmed as 0.5 m, the required pedestrian-like setback is provided, and all district-plan conditions are satisfied, the plan allows additions to the base FAR:

| Actual wall setback | Possible addition | Preliminary resulting FAR |
|---:|---:|---:|
| 0.50 m to under 0.75 m | +60% | 538.2% |
| 0.75 m to under 1.00 m | +90% | 568.2% |
| 1.00 m or more | +120% | 598.2% |

These are scenario calculations, not entitlements. The result also remains subject to the applicable designated and district-plan caps. Floor area above the base FAR is restricted to qualifying residential-type uses under the district plan; qualifying apartments must generally have dwelling units of at least 40 m².

### Product display policy

The future regulation calculator should show two results without mixing them:

1. **Primary result — strict / no relaxation:** use the 478.2% road-width FAR, 80% building coverage, and ordinary road sloping-plane control. Do not add the district-plan FAR bonus, road-slope relaxation, or fire-district building-coverage increase.
2. **Reference result — maximum conditional case:** show the largest plausible value separately, together with every unconfirmed condition. This is not the default result and must never be presented as an acquired right.

For a pure apartment scenario, the preliminary maximum conditional FAR is 598.2% with at least 1.0 m actual wall setback. For pure commercial and hotel scenarios, this memo conservatively keeps FAR at 478.2%, because the district-plan text reserves floor area above the base FAR for housing and listed housing-like uses. A hotel is not expressly listed; Chiyoda City interpretation must be confirmed.

The mapped wall line and the optional FAR addition are separate concepts. If the frontage is confirmed to have a 0.5 m wall line, the minimum setback is mandatory. Increasing it to 0.75 m or 1.0 m changes FAR only when the district-plan bonus is being used. With all relaxations switched off, extra setback does not raise FAR, although it changes the footprint and can affect the ordinary road-slope geometry.

At the surveyed 92.34 m² site area, the preliminary gross-floor-area scenarios are approximately:

| FAR scenario | Gross floor area |
|---:|---:|
| 478.2% base | 441.6 m² |
| 538.2% | 496.9 m² |
| 568.2% | 524.7 m² |
| 598.2% | 552.4 m² |

## Building coverage

The designated building coverage ratio is 80%. In a fire prevention district, a qualifying fire-resistant building may receive the Building Standards Act Article 53 increase, potentially making **90%** the working cap. This depends on the actual building specification and statutory conditions and must not be applied automatically.

For a 92.34 m² site:

- At 80%: maximum footprint before other restrictions is approximately **73.87 m²**.
- At 90%: maximum footprint before other restrictions is approximately **83.11 m²**.

The district-plan wall setback, required open space, shafts, access, structure, and other rules can reduce the buildable footprint further.

## Height and sloping-plane controls

- The standard Building Standards Act road sloping-plane control for a commercial zone uses a **1.5 slope** from the opposite-side road boundary, subject to statutory measurement rules and alternatives.
- The adjacent-land sloping-plane control generally begins at **31 m** and uses a **2.5 slope** in this zone.
- The north-side sloping-plane control does not ordinarily apply to a commercial zone.
- The Sotokanda district plan can relax the road sloping-plane control on mapped wall-line roads when its detailed conditions are met, but the district-plan height cap still applies.
- The likely B-district height cap is **45 m**. Its reduced caps are 28 m for sites facing only roads 6 m or less, and 21 m for sites facing only roads 4 m or less. The supplied 7.970 m road suggests neither reduction, subject to official confirmation.

The final envelope will need the exact road elevation, opposite boundary, setback geometry, wall-line status, and rooftop-equipment treatment. These cannot be reliably determined from the street address alone.

## Other controls to carry into later design stages

- The district plan restricts certain adult-entertainment and related uses.
- For some apartment buildings with at least 10 units and at least 4 floors, dwelling-unit composition rules apply.
- A district-plan notification is normally required before construction or relevant changes.
- In the Kanda landscape area, a new building over 10 m may require landscape procedures; signs can require coordinated review.
- Accessibility, parking/loading, fire egress, structural, energy, shadow, excavation, and use-specific rules depend on the proposed use and design. They are outside this prototype's first-step image-reading scope.

## Items that must be confirmed before automating a 3D envelope

1. Exact planning-portal pin for 3-12-2 and parcel correspondence to lots 91-2 / 91-3.
2. B-district classification and the exact wall-line color/offset on Plan Drawing 2.
3. Current road ledger, road boundary, width, elevation, and Article 42 classification.
4. Whether the planned construction qualifies for the fire-district building-coverage increase.
5. Proposed use mix, because the FAR bonus above the base is tied to qualifying housing.
6. Whether the district-plan road-slope relaxation is being used and all related design conditions are satisfied.
7. Any current administrative interpretation obtained through pre-consultation with Chiyoda Ward.

## Official sources

- [Chiyoda City: urban planning information and portal](https://www.city.chiyoda.lg.jp/koho/machizukuri/toshi/yotochiiki/chikuzu.html)
- [Chiyoda City: urban planning map — use zones and district designations (March 31, 2026 status)](https://www.city.chiyoda.lg.jp/documents/275/keikakuzu-1_2.pdf)
- [Chiyoda City: Sotokanda 2- and 3-chome District Plan](https://www.city.chiyoda.lg.jp/koho/machizukuri/toshi/toshikeikakuzu/pdf/25sotokanda.pdf)
- [Chiyoda City: district-plan FAQ](https://www.city.chiyoda.lg.jp/koho/machizukuri/toshi/chikukekaku/faq.html)
- [Chiyoda City: greening promotion guidelines](https://www.city.chiyoda.lg.jp/koho/machizukuri/kankyo/ryokuka/yoko.html)
- [Chiyoda City: outdoor advertising and landscape guideline](https://www.city.chiyoda.lg.jp/documents/4204/okugaikokoku-gaidorain.pdf)
- [e-Gov: Building Standards Act](https://laws.e-gov.go.jp/law/325AC0000000201)

## Disclaimer

This memo is a preliminary feasibility aid prepared from the supplied survey image and publicly available official sources. It is not a legal opinion, boundary survey, code-compliance certificate, or substitute for consultation with Chiyoda City and a licensed architect.
