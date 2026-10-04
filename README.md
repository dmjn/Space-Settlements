# Space Settlements

An interactive atlas of the rotating space settlements designed between 1969 and 1977, part of the Worldmaking Project by Damjan Jovanovic.

The atlas opens five designs in realtime 3D cutaway, each with callouts, a part-by-part sheet, a guided tour and live systems diagrams:

- Stanford Torus (NASA Ames and Stanford summer study, 1975)
- Model One (O'Neill, 1976)
- Bernal Sphere, Island One (O'Neill, 1976)
- Island Two (O'Neill, 1976)
- O'Neill Cylinder, Island Three (O'Neill, 1976)

It also covers the system around the habitats on five topic pages: the colony's economy, solar power satellites, the lunar mass driver, the construction timeline, and a habitat designer that tests a shape against the 1975 study's criteria.

## Publishing on GitHub Pages

1. Create a new repository, for example `space-settlements`.
2. Upload everything in this folder to the root of the repository, including the hidden `.nojekyll` file.
3. In the repository, open **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, select `main` and `/ (root)`, and save.
4. After a minute the site is live at `https://<username>.github.io/space-settlements/`.

For link previews on social media, replace `og.png` in the `og:image` and `twitter:image` tags of `index.html` with the full URL, for example `https://<username>.github.io/space-settlements/og.png`. Some sites only read absolute image URLs.

Everything is self-hosted: three.js, the fonts and the app script load from this folder, so the site works without any third-party CDN. Navigation uses URL hashes (`#torus`, `#bernal`, `#oneill`, `#island2`, `#model1`, `#economy`, `#energy`, `#massdriver`, `#build`, `#design`), so direct links to any habitat or topic work on GitHub Pages without extra configuration.

## Files

| Path | Contents |
| --- | --- |
| `index.html` | Page markup and styles |
| `app.js` | Models, diagrams, tours, topic pages and routing |
| `vendor/` | three.js r128 and OrbitControls (MIT License) |
| `fonts/` | Chakra Petch, IBM Plex Sans and IBM Plex Mono, latin and latin-ext subsets (SIL Open Font License) |
| `favicon.svg`, `og.png` | Icon and social preview image |
| `.nojekyll` | Tells GitHub Pages to serve the files as they are |

To preview locally, run `python3 -m http.server` in this folder and open `http://localhost:8000`. Opening `index.html` directly from disk also works in most browsers.

## Sources

- Richard D. Johnson and Charles Holbrow, eds., [*Space Settlements: A Design Study*](https://nss.org/settlement/nasa/75SummerStudy/Table_of_Contents1.html), NASA SP-413 (1977)
- Gerard K. O'Neill, *The High Frontier: Human Colonies in Space* (1976)

Requires a browser with WebGL.
