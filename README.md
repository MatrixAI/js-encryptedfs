React Experiments
======================

Front end experiments with react, styled components and d3 and webpack (instead of rollup since this is for applications), not libraries.

So all react packages should use the same version. So we are using 16.2.0 basically.

We now need to run the react to actually compile out the code into a client side application. How do we do this without create-react-app?

So since we using webpack, instead of the rollup plugins, we need webpack plugins, one of them is called the `babel-loader`, which apparently webpack uses to load our files together. But we also seem to get the `babel-core` which I'm not sure why we need. The `babel-cli` already brings in `babel-core` I believe. If you want the CLI as well, you just pick `babel-cli` no need for the core. We can use `babel-polyfill` for the app (unlike `babel-runtime` for libraries).

To use `webpack.config.babel.js` you need `babel-register`. It's also true that ava requires `babel-register` as well so it's a pretty good test suite.

Once we have finished creating the webpack bundle. It is in the `public` directory. But this is not the proper build directory. In fact every time you build, you get a new webpack thing. In that case we can add and commit it, just like a library, but it's a big file. It is the compiled application. And then all we do is serve the file from a local web server. Which in this case points to public as a directory that is public.

Note that with SPA, cause you're JS has special routes, it needs to override how your URLs, so that the webserver doesn't see it. Usually this is done via hashbang routes, which doesn't affect the real webserver. But hashbang routes are ugly and so we have normal URLs. But with normal URLs, the main issue is that on first request, one has to hit http://website/thing where thing is a front end route. That means the webserver delivers the index.html, while it then interprets what thing is, and paints the site. (Alternatively there's isomorphic react apps which delivers the website/thing fully formed, but this is unnecessary in most cases). So this is what the local webserver needs to realise as well.

Note that this does not have autoreload unfortunately lol. You need something else to autoreload your web server now. But if you make changes to HTML, you just have to autoreload.

Anyway for now this works. We run `npm run build` and also `npm run serve`. And we just refresh the browser. Done.

Our script is loaded explicitly unlike create-react-app, not sure how it injects things into it.

Now that we have a simple hello world ready, we want create some exxtra components and perform routing over it. So `react-router` basically.

Turns out that react preset doesn't bring in object spread nor class properties. So we bring them in independently. Also flow is in explicitly anyway regardless of react bringing in flow because in the future react may not have flow, but I know I want flow here.

Another repository may then incorporate react-native and electron components and bring these together.

---

One issue is that users of this will need dos2unix.
