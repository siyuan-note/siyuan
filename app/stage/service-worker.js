// REF https://github.com/MicrosoftEdge/Demos/blob/main/pwamp/sw.js

const url = new URL(location.href);
const SIYUAN_VERSION = url.searchParams.get("v");
const CACHE_NAME = `siyuan-${SIYUAN_VERSION}`;
const INITIAL_CACHED_RESOURCES = [
    "/stage/build",
    "/stage/icon-large.png",
    "/stage/icon.png",
    "/stage/images",
    "/stage/images/sync-guide.svg",
    "/stage/loading-pure.svg",
    "/stage/loading.svg",
    "/stage/protyle",
    "/stage/protyle/js",
    "/stage/protyle/js/abcjs",
    "/stage/protyle/js/abcjs/abcjs-basic-min.js",
    "/stage/protyle/js/abcjs/abcjs-basic-min.js.LICENSE",
    "/stage/protyle/js/echarts",
    "/stage/protyle/js/echarts/echarts-gl.min.js",
    "/stage/protyle/js/echarts/echarts.min.js",
    "/stage/protyle/js/flowchart.js",
    "/stage/protyle/js/flowchart.js/flowchart.min.js",
    "/stage/protyle/js/graphviz",
    "/stage/protyle/js/graphviz/full.render.js",
    "/stage/protyle/js/graphviz/viz.js",
    "/stage/protyle/js/highlight.js",
    "/stage/protyle/js/highlight.js/LICENSE",
    "/stage/protyle/js/highlight.js/highlight.min.js",
    "/stage/protyle/js/highlight.js/styles",
    "/stage/protyle/js/highlight.js/styles/a11y-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/a11y-light.min.css",
    "/stage/protyle/js/highlight.js/styles/agate.min.css",
    "/stage/protyle/js/highlight.js/styles/an-old-hope.min.css",
    "/stage/protyle/js/highlight.js/styles/androidstudio.min.css",
    "/stage/protyle/js/highlight.js/styles/ant-design.css",
    "/stage/protyle/js/highlight.js/styles/arduino-light.min.css",
    "/stage/protyle/js/highlight.js/styles/arta.min.css",
    "/stage/protyle/js/highlight.js/styles/ascetic.min.css",
    "/stage/protyle/js/highlight.js/styles/atom-one-dark-reasonable.min.css",
    "/stage/protyle/js/highlight.js/styles/atom-one-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/atom-one-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16",
    "/stage/protyle/js/highlight.js/styles/base16/3024.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/apathy.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/apprentice.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/ashes.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/atelier-cave-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/atelier-cave.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/atelier-dune-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/atelier-dune.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/atelier-estuary-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/atelier-estuary.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/atelier-forest-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/atelier-forest.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/atelier-heath-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/atelier-heath.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/atelier-lakeside-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/atelier-lakeside.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/atelier-plateau-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/atelier-plateau.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/atelier-savanna-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/atelier-savanna.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/atelier-seaside-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/atelier-seaside.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/atelier-sulphurpool-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/atelier-sulphurpool.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/atlas.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/bespin.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/black-metal-bathory.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/black-metal-burzum.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/black-metal-dark-funeral.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/black-metal-gorgoroth.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/black-metal-immortal.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/black-metal-khold.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/black-metal-marduk.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/black-metal-mayhem.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/black-metal-nile.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/black-metal-venom.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/black-metal.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/brewer.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/bright.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/brogrammer.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/brush-trees-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/brush-trees.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/chalk.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/circus.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/classic-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/classic-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/codeschool.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/colors.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/cupcake.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/cupertino.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/danqing.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/darcula.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/dark-violet.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/darkmoss.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/darktooth.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/decaf.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/default-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/default-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/dirtysea.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/dracula.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/edge-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/edge-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/eighties.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/embers.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/equilibrium-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/equilibrium-gray-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/equilibrium-gray-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/equilibrium-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/espresso.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/eva-dim.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/eva.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/flat.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/framer.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/fruit-soda.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/gigavolt.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/github.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/google-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/google-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/grayscale-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/grayscale-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/green-screen.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/gruvbox-dark-hard.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/gruvbox-dark-medium.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/gruvbox-dark-pale.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/gruvbox-dark-soft.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/gruvbox-light-hard.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/gruvbox-light-medium.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/gruvbox-light-soft.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/hardcore.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/harmonic16-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/harmonic16-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/heetch-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/heetch-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/helios.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/hopscotch.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/horizon-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/horizon-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/humanoid-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/humanoid-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/ia-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/ia-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/icy-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/ir-black.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/isotope.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/kimber.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/london-tube.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/macintosh.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/marrakesh.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/materia.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/material-darker.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/material-lighter.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/material-palenight.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/material-vivid.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/material.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/mellow-purple.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/mexico-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/mocha.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/monokai.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/nebula.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/nord.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/nova.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/ocean.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/oceanicnext.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/one-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/onedark.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/outrun-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/papercolor-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/papercolor-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/paraiso.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/pasque.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/phd.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/pico.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/pop.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/porple.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/qualia.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/railscasts.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/rebecca.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/ros-pine-dawn.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/ros-pine-moon.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/ros-pine.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/sagelight.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/sandcastle.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/seti-ui.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/shapeshifter.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/silk-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/silk-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/snazzy.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/solar-flare-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/solar-flare.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/solarized-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/solarized-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/spacemacs.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/summercamp.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/summerfruit-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/summerfruit-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/synth-midnight-terminal-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/synth-midnight-terminal-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/tango.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/tender.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/tomorrow-night.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/tomorrow.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/twilight.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/unikitty-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/unikitty-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/vulcan.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/windows-10-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/windows-10.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/windows-95-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/windows-95.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/windows-high-contrast-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/windows-high-contrast.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/windows-nt-light.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/windows-nt.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/woodland.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/xcode-dusk.min.css",
    "/stage/protyle/js/highlight.js/styles/base16/zenburn.min.css",
    "/stage/protyle/js/highlight.js/styles/brown-paper.min.css",
    "/stage/protyle/js/highlight.js/styles/brown-papersq.png",
    "/stage/protyle/js/highlight.js/styles/codepen-embed.min.css",
    "/stage/protyle/js/highlight.js/styles/color-brewer.min.css",
    "/stage/protyle/js/highlight.js/styles/dark.min.css",
    "/stage/protyle/js/highlight.js/styles/default.min.css",
    "/stage/protyle/js/highlight.js/styles/devibeans.min.css",
    "/stage/protyle/js/highlight.js/styles/docco.min.css",
    "/stage/protyle/js/highlight.js/styles/far.min.css",
    "/stage/protyle/js/highlight.js/styles/felipec.min.css",
    "/stage/protyle/js/highlight.js/styles/foundation.min.css",
    "/stage/protyle/js/highlight.js/styles/github-dark-dimmed.min.css",
    "/stage/protyle/js/highlight.js/styles/github-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/github.min.css",
    "/stage/protyle/js/highlight.js/styles/gml.min.css",
    "/stage/protyle/js/highlight.js/styles/googlecode.min.css",
    "/stage/protyle/js/highlight.js/styles/gradient-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/gradient-light.min.css",
    "/stage/protyle/js/highlight.js/styles/grayscale.min.css",
    "/stage/protyle/js/highlight.js/styles/hybrid.min.css",
    "/stage/protyle/js/highlight.js/styles/idea.min.css",
    "/stage/protyle/js/highlight.js/styles/intellij-light.min.css",
    "/stage/protyle/js/highlight.js/styles/ir-black.min.css",
    "/stage/protyle/js/highlight.js/styles/isbl-editor-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/isbl-editor-light.min.css",
    "/stage/protyle/js/highlight.js/styles/kimbie-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/kimbie-light.min.css",
    "/stage/protyle/js/highlight.js/styles/lightfair.min.css",
    "/stage/protyle/js/highlight.js/styles/lioshi.min.css",
    "/stage/protyle/js/highlight.js/styles/magula.min.css",
    "/stage/protyle/js/highlight.js/styles/mono-blue.min.css",
    "/stage/protyle/js/highlight.js/styles/monokai-sublime.min.css",
    "/stage/protyle/js/highlight.js/styles/monokai.min.css",
    "/stage/protyle/js/highlight.js/styles/night-owl.min.css",
    "/stage/protyle/js/highlight.js/styles/nnfx-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/nnfx-light.min.css",
    "/stage/protyle/js/highlight.js/styles/nord.min.css",
    "/stage/protyle/js/highlight.js/styles/obsidian.min.css",
    "/stage/protyle/js/highlight.js/styles/panda-syntax-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/panda-syntax-light.min.css",
    "/stage/protyle/js/highlight.js/styles/paraiso-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/paraiso-light.min.css",
    "/stage/protyle/js/highlight.js/styles/pojoaque.jpg",
    "/stage/protyle/js/highlight.js/styles/pojoaque.min.css",
    "/stage/protyle/js/highlight.js/styles/purebasic.min.css",
    "/stage/protyle/js/highlight.js/styles/qtcreator-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/qtcreator-light.min.css",
    "/stage/protyle/js/highlight.js/styles/rainbow.min.css",
    "/stage/protyle/js/highlight.js/styles/routeros.min.css",
    "/stage/protyle/js/highlight.js/styles/school-book.min.css",
    "/stage/protyle/js/highlight.js/styles/shades-of-purple.min.css",
    "/stage/protyle/js/highlight.js/styles/srcery.min.css",
    "/stage/protyle/js/highlight.js/styles/stackoverflow-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/stackoverflow-light.min.css",
    "/stage/protyle/js/highlight.js/styles/sunburst.min.css",
    "/stage/protyle/js/highlight.js/styles/tokyo-night-dark.min.css",
    "/stage/protyle/js/highlight.js/styles/tokyo-night-light.min.css",
    "/stage/protyle/js/highlight.js/styles/tomorrow-night-blue.min.css",
    "/stage/protyle/js/highlight.js/styles/tomorrow-night-bright.min.css",
    "/stage/protyle/js/highlight.js/styles/vs.min.css",
    "/stage/protyle/js/highlight.js/styles/vs2015.min.css",
    "/stage/protyle/js/highlight.js/styles/xcode.min.css",
    "/stage/protyle/js/highlight.js/styles/xt256.min.css",
    "/stage/protyle/js/highlight.js/third-languages.js",
    "/stage/protyle/js/html2canvas.min.js",
    "/stage/protyle/js/katex",
    "/stage/protyle/js/katex/fonts",
    "/stage/protyle/js/katex/fonts/KaTeX_AMS-Regular.ttf",
    "/stage/protyle/js/katex/fonts/KaTeX_AMS-Regular.woff",
    "/stage/protyle/js/katex/fonts/KaTeX_AMS-Regular.woff2",
    "/stage/protyle/js/katex/fonts/KaTeX_Caligraphic-Bold.ttf",
    "/stage/protyle/js/katex/fonts/KaTeX_Caligraphic-Bold.woff",
    "/stage/protyle/js/katex/fonts/KaTeX_Caligraphic-Bold.woff2",
    "/stage/protyle/js/katex/fonts/KaTeX_Caligraphic-Regular.ttf",
    "/stage/protyle/js/katex/fonts/KaTeX_Caligraphic-Regular.woff",
    "/stage/protyle/js/katex/fonts/KaTeX_Caligraphic-Regular.woff2",
    "/stage/protyle/js/katex/fonts/KaTeX_Fraktur-Bold.ttf",
    "/stage/protyle/js/katex/fonts/KaTeX_Fraktur-Bold.woff",
    "/stage/protyle/js/katex/fonts/KaTeX_Fraktur-Bold.woff2",
    "/stage/protyle/js/katex/fonts/KaTeX_Fraktur-Regular.ttf",
    "/stage/protyle/js/katex/fonts/KaTeX_Fraktur-Regular.woff",
    "/stage/protyle/js/katex/fonts/KaTeX_Fraktur-Regular.woff2",
    "/stage/protyle/js/katex/fonts/KaTeX_Main-Bold.ttf",
    "/stage/protyle/js/katex/fonts/KaTeX_Main-Bold.woff",
    "/stage/protyle/js/katex/fonts/KaTeX_Main-Bold.woff2",
    "/stage/protyle/js/katex/fonts/KaTeX_Main-BoldItalic.ttf",
    "/stage/protyle/js/katex/fonts/KaTeX_Main-BoldItalic.woff",
    "/stage/protyle/js/katex/fonts/KaTeX_Main-BoldItalic.woff2",
    "/stage/protyle/js/katex/fonts/KaTeX_Main-Italic.ttf",
    "/stage/protyle/js/katex/fonts/KaTeX_Main-Italic.woff",
    "/stage/protyle/js/katex/fonts/KaTeX_Main-Italic.woff2",
    "/stage/protyle/js/katex/fonts/KaTeX_Main-Regular.ttf",
    "/stage/protyle/js/katex/fonts/KaTeX_Main-Regular.woff",
    "/stage/protyle/js/katex/fonts/KaTeX_Main-Regular.woff2",
    "/stage/protyle/js/katex/fonts/KaTeX_Math-BoldItalic.ttf",
    "/stage/protyle/js/katex/fonts/KaTeX_Math-BoldItalic.woff",
    "/stage/protyle/js/katex/fonts/KaTeX_Math-BoldItalic.woff2",
    "/stage/protyle/js/katex/fonts/KaTeX_Math-Italic.ttf",
    "/stage/protyle/js/katex/fonts/KaTeX_Math-Italic.woff",
    "/stage/protyle/js/katex/fonts/KaTeX_Math-Italic.woff2",
    "/stage/protyle/js/katex/fonts/KaTeX_SansSerif-Bold.ttf",
    "/stage/protyle/js/katex/fonts/KaTeX_SansSerif-Bold.woff",
    "/stage/protyle/js/katex/fonts/KaTeX_SansSerif-Bold.woff2",
    "/stage/protyle/js/katex/fonts/KaTeX_SansSerif-Italic.ttf",
    "/stage/protyle/js/katex/fonts/KaTeX_SansSerif-Italic.woff",
    "/stage/protyle/js/katex/fonts/KaTeX_SansSerif-Italic.woff2",
    "/stage/protyle/js/katex/fonts/KaTeX_SansSerif-Regular.ttf",
    "/stage/protyle/js/katex/fonts/KaTeX_SansSerif-Regular.woff",
    "/stage/protyle/js/katex/fonts/KaTeX_SansSerif-Regular.woff2",
    "/stage/protyle/js/katex/fonts/KaTeX_Script-Regular.ttf",
    "/stage/protyle/js/katex/fonts/KaTeX_Script-Regular.woff",
    "/stage/protyle/js/katex/fonts/KaTeX_Script-Regular.woff2",
    "/stage/protyle/js/katex/fonts/KaTeX_Size1-Regular.ttf",
    "/stage/protyle/js/katex/fonts/KaTeX_Size1-Regular.woff",
    "/stage/protyle/js/katex/fonts/KaTeX_Size1-Regular.woff2",
    "/stage/protyle/js/katex/fonts/KaTeX_Size2-Regular.ttf",
    "/stage/protyle/js/katex/fonts/KaTeX_Size2-Regular.woff",
    "/stage/protyle/js/katex/fonts/KaTeX_Size2-Regular.woff2",
    "/stage/protyle/js/katex/fonts/KaTeX_Size3-Regular.ttf",
    "/stage/protyle/js/katex/fonts/KaTeX_Size3-Regular.woff",
    "/stage/protyle/js/katex/fonts/KaTeX_Size3-Regular.woff2",
    "/stage/protyle/js/katex/fonts/KaTeX_Size4-Regular.ttf",
    "/stage/protyle/js/katex/fonts/KaTeX_Size4-Regular.woff",
    "/stage/protyle/js/katex/fonts/KaTeX_Size4-Regular.woff2",
    "/stage/protyle/js/katex/fonts/KaTeX_Typewriter-Regular.ttf",
    "/stage/protyle/js/katex/fonts/KaTeX_Typewriter-Regular.woff",
    "/stage/protyle/js/katex/fonts/KaTeX_Typewriter-Regular.woff2",
    "/stage/protyle/js/katex/katex.min.css",
    "/stage/protyle/js/katex/katex.min.js",
    "/stage/protyle/js/katex/mhchem.min.js",
    "/stage/protyle/js/lute",
    "/stage/protyle/js/lute/lute.min.js",
    "/stage/protyle/js/mermaid",
    "/stage/protyle/js/mermaid/mermaid.min.js",
    "/stage/protyle/js/pdf",
    "/stage/protyle/js/pdf/cmaps",
    "/stage/protyle/js/pdf/cmaps/78-EUC-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/78-EUC-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/78-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/78-RKSJ-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/78-RKSJ-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/78-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/78ms-RKSJ-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/78ms-RKSJ-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/83pv-RKSJ-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/90ms-RKSJ-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/90ms-RKSJ-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/90msp-RKSJ-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/90msp-RKSJ-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/90pv-RKSJ-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/90pv-RKSJ-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/Add-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/Add-RKSJ-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/Add-RKSJ-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/Add-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/Adobe-CNS1-0.bcmap",
    "/stage/protyle/js/pdf/cmaps/Adobe-CNS1-1.bcmap",
    "/stage/protyle/js/pdf/cmaps/Adobe-CNS1-2.bcmap",
    "/stage/protyle/js/pdf/cmaps/Adobe-CNS1-3.bcmap",
    "/stage/protyle/js/pdf/cmaps/Adobe-CNS1-4.bcmap",
    "/stage/protyle/js/pdf/cmaps/Adobe-CNS1-5.bcmap",
    "/stage/protyle/js/pdf/cmaps/Adobe-CNS1-6.bcmap",
    "/stage/protyle/js/pdf/cmaps/Adobe-CNS1-UCS2.bcmap",
    "/stage/protyle/js/pdf/cmaps/Adobe-GB1-0.bcmap",
    "/stage/protyle/js/pdf/cmaps/Adobe-GB1-1.bcmap",
    "/stage/protyle/js/pdf/cmaps/Adobe-GB1-2.bcmap",
    "/stage/protyle/js/pdf/cmaps/Adobe-GB1-3.bcmap",
    "/stage/protyle/js/pdf/cmaps/Adobe-GB1-4.bcmap",
    "/stage/protyle/js/pdf/cmaps/Adobe-GB1-5.bcmap",
    "/stage/protyle/js/pdf/cmaps/Adobe-GB1-UCS2.bcmap",
    "/stage/protyle/js/pdf/cmaps/Adobe-Japan1-0.bcmap",
    "/stage/protyle/js/pdf/cmaps/Adobe-Japan1-1.bcmap",
    "/stage/protyle/js/pdf/cmaps/Adobe-Japan1-2.bcmap",
    "/stage/protyle/js/pdf/cmaps/Adobe-Japan1-3.bcmap",
    "/stage/protyle/js/pdf/cmaps/Adobe-Japan1-4.bcmap",
    "/stage/protyle/js/pdf/cmaps/Adobe-Japan1-5.bcmap",
    "/stage/protyle/js/pdf/cmaps/Adobe-Japan1-6.bcmap",
    "/stage/protyle/js/pdf/cmaps/Adobe-Japan1-UCS2.bcmap",
    "/stage/protyle/js/pdf/cmaps/Adobe-Korea1-0.bcmap",
    "/stage/protyle/js/pdf/cmaps/Adobe-Korea1-1.bcmap",
    "/stage/protyle/js/pdf/cmaps/Adobe-Korea1-2.bcmap",
    "/stage/protyle/js/pdf/cmaps/Adobe-Korea1-UCS2.bcmap",
    "/stage/protyle/js/pdf/cmaps/B5-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/B5-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/B5pc-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/B5pc-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/CNS-EUC-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/CNS-EUC-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/CNS1-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/CNS1-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/CNS2-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/CNS2-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/ETHK-B5-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/ETHK-B5-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/ETen-B5-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/ETen-B5-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/ETenms-B5-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/ETenms-B5-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/EUC-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/EUC-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/Ext-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/Ext-RKSJ-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/Ext-RKSJ-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/Ext-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/GB-EUC-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/GB-EUC-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/GB-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/GB-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/GBK-EUC-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/GBK-EUC-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/GBK2K-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/GBK2K-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/GBKp-EUC-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/GBKp-EUC-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/GBT-EUC-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/GBT-EUC-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/GBT-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/GBT-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/GBTpc-EUC-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/GBTpc-EUC-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/GBpc-EUC-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/GBpc-EUC-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/H.bcmap",
    "/stage/protyle/js/pdf/cmaps/HKdla-B5-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/HKdla-B5-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/HKdlb-B5-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/HKdlb-B5-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/HKgccs-B5-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/HKgccs-B5-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/HKm314-B5-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/HKm314-B5-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/HKm471-B5-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/HKm471-B5-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/HKscs-B5-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/HKscs-B5-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/Hankaku.bcmap",
    "/stage/protyle/js/pdf/cmaps/Hiragana.bcmap",
    "/stage/protyle/js/pdf/cmaps/KSC-EUC-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/KSC-EUC-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/KSC-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/KSC-Johab-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/KSC-Johab-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/KSC-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/KSCms-UHC-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/KSCms-UHC-HW-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/KSCms-UHC-HW-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/KSCms-UHC-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/KSCpc-EUC-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/KSCpc-EUC-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/Katakana.bcmap",
    "/stage/protyle/js/pdf/cmaps/LICENSE",
    "/stage/protyle/js/pdf/cmaps/NWP-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/NWP-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/RKSJ-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/RKSJ-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/Roman.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniCNS-UCS2-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniCNS-UCS2-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniCNS-UTF16-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniCNS-UTF16-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniCNS-UTF32-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniCNS-UTF32-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniCNS-UTF8-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniCNS-UTF8-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniGB-UCS2-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniGB-UCS2-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniGB-UTF16-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniGB-UTF16-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniGB-UTF32-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniGB-UTF32-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniGB-UTF8-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniGB-UTF8-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniJIS-UCS2-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniJIS-UCS2-HW-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniJIS-UCS2-HW-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniJIS-UCS2-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniJIS-UTF16-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniJIS-UTF16-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniJIS-UTF32-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniJIS-UTF32-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniJIS-UTF8-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniJIS-UTF8-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniJIS2004-UTF16-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniJIS2004-UTF16-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniJIS2004-UTF32-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniJIS2004-UTF32-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniJIS2004-UTF8-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniJIS2004-UTF8-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniJISPro-UCS2-HW-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniJISPro-UCS2-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniJISPro-UTF8-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniJISX0213-UTF32-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniJISX0213-UTF32-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniJISX02132004-UTF32-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniJISX02132004-UTF32-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniKS-UCS2-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniKS-UCS2-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniKS-UTF16-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniKS-UTF16-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniKS-UTF32-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniKS-UTF32-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniKS-UTF8-H.bcmap",
    "/stage/protyle/js/pdf/cmaps/UniKS-UTF8-V.bcmap",
    "/stage/protyle/js/pdf/cmaps/V.bcmap",
    "/stage/protyle/js/pdf/cmaps/WP-Symbol.bcmap",
    "/stage/protyle/js/pdf/pdf.js",
    "/stage/protyle/js/pdf/pdf.worker.js",
    "/stage/protyle/js/pdf/standard_fonts",
    "/stage/protyle/js/pdf/standard_fonts/FoxitDingbats.pfb",
    "/stage/protyle/js/pdf/standard_fonts/FoxitFixed.pfb",
    "/stage/protyle/js/pdf/standard_fonts/FoxitFixedBold.pfb",
    "/stage/protyle/js/pdf/standard_fonts/FoxitFixedBoldItalic.pfb",
    "/stage/protyle/js/pdf/standard_fonts/FoxitFixedItalic.pfb",
    "/stage/protyle/js/pdf/standard_fonts/FoxitSans.pfb",
    "/stage/protyle/js/pdf/standard_fonts/FoxitSansBold.pfb",
    "/stage/protyle/js/pdf/standard_fonts/FoxitSansBoldItalic.pfb",
    "/stage/protyle/js/pdf/standard_fonts/FoxitSansItalic.pfb",
    "/stage/protyle/js/pdf/standard_fonts/FoxitSerif.pfb",
    "/stage/protyle/js/pdf/standard_fonts/FoxitSerifBold.pfb",
    "/stage/protyle/js/pdf/standard_fonts/FoxitSerifBoldItalic.pfb",
    "/stage/protyle/js/pdf/standard_fonts/FoxitSerifItalic.pfb",
    "/stage/protyle/js/pdf/standard_fonts/FoxitSymbol.pfb",
    "/stage/protyle/js/pdf/standard_fonts/LICENSE_FOXIT",
    "/stage/protyle/js/pdf/standard_fonts/LICENSE_LIBERATION",
    "/stage/protyle/js/pdf/standard_fonts/LiberationSans-Bold.ttf",
    "/stage/protyle/js/pdf/standard_fonts/LiberationSans-BoldItalic.ttf",
    "/stage/protyle/js/pdf/standard_fonts/LiberationSans-Italic.ttf",
    "/stage/protyle/js/pdf/standard_fonts/LiberationSans-Regular.ttf",
    "/stage/protyle/js/plantuml",
    "/stage/protyle/js/plantuml/plantuml-encoder.min.js",
    "/stage/protyle/js/protyle-html.js",
    "/stage/protyle/js/viewerjs",
    "/stage/protyle/js/viewerjs/viewer.js",
    "/stage/protyle/js/vis",
    "/stage/protyle/js/vis/vis-network.min.js",
];

self.addEventListener("message", event => {
    // event is an ExtendableMessageEvent object
    console.debug("service-worker: onmessage", event);
    event.source.postMessage("service-worker: post message");
});

self.addEventListener("install", event => {
    console.debug("service-worker: oninstall", event);
    self.skipWaiting();
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        cache.addAll(INITIAL_CACHED_RESOURCES);
    })());
});

self.addEventListener("activate", event => {
    console.debug("service-worker: onactivate", event);
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.map(name => {
            if (name !== CACHE_NAME) {
                return caches.delete(name);
            }
        }));
        await clients.claim();
    })());
});

(async () => {
    self.addEventListener("fetch", event => {
        const url = new URL(event.request.url);

        // Don't care about other-origin URLs.
        if (url.origin !== location.origin) {
            return;
        }

        // Don't care about anything else than GET.
        if (event.request.method !== 'GET') {
            return;
        }

        // Don't care about widget requests.
        if (!url.pathname.startsWith("/stage/")) {
            return;
        }

        // On fetch, go to the cache first, and then network.
        event.respondWith((async () => {
            const cache = await caches.open(CACHE_NAME);
            const cachedResponse = await cache.match(url.pathname);

            if (cachedResponse) {
                return cachedResponse;
            } else {
                const fetchResponse = await fetch(url.pathname);
                cache.put(url.pathname, fetchResponse.clone());
                return fetchResponse;
            }
        })());
    });
})();
