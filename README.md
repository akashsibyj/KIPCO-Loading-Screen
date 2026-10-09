# KIPCO Loading Screen

An animated KIPCO loading screen built with plain HTML, CSS and JavaScript (SVG graphics, no libraries).

## Run it locally

You need Node.js. In a terminal in this folder (in VS Code: Terminal → New Terminal):

```bash
npm start
```

Then open **http://localhost:3000**. If port 3000 is busy, it uses 3001, 3002 and so on, and prints the address. Press **Ctrl+C** to stop. There are no dependencies, so `npm install` isn't needed.

## Deploy on Vercel

Push to GitHub and import the repository in Vercel. `vercel.json` tells Vercel to serve the `public` folder as a static site, so no project settings need changing.

## Files

| File | Purpose |
| --- | --- |
| `public/index.html` | The page. `--kl-size` sets the size (0.55 = about half the screen) |
| `public/src/kipco-loader.js` | The animation. All timings are in `TIMELINE` at the top |
| `public/src/kipco-loader.css` | Layout and colours (`--kl-*` tokens) |
| `public/assets/kipco-logo.png` | Official KIPCO logo |
| `dev-server.js` | Small local web server used by `npm start` (not used on Vercel) |
| `package.json` | Defines the `npm start` command |
| `vercel.json` | Tells Vercel to serve `public` as a static site |
| `LICENSE-Montserrat.txt` | Licence for the Montserrat font embedded in the CSS (keep this file) |

## Use with real loading progress

```html
<kipco-loader manual></kipco-loader>
<script>
  const loader = document.querySelector('kipco-loader');
  loader.setProgress(0.4);   // 0..1
  loader.complete();         // when your app is ready
  loader.addEventListener('kipco:ready', () => loader.dismiss());
</script>
```

Without `manual`, the bar fills automatically.
