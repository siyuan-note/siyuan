const express = require('express');
const session = require('express-session');
const dotenv = require('dotenv');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const { createProxyMiddleware } = require('http-proxy-middleware');

dotenv.config();

const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_CALLBACK_URL, SESSION_SECRET = 'keyboard' } = process.env;

if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !DISCORD_CALLBACK_URL) {
  console.error('Discord OAuth2 env vars missing');
  process.exit(1);
}

passport.serializeUser((u, d) => d(null, u));
passport.deserializeUser((u, d) => d(null, u));

passport.use(new DiscordStrategy(
  { clientID: DISCORD_CLIENT_ID, clientSecret: DISCORD_CLIENT_SECRET, callbackURL: DISCORD_CALLBACK_URL, scope: ['identify', 'guilds'] },
  (_a, _b, profile, done) => done(null, profile)
));

const app = express();
app.use(session({ secret: SESSION_SECRET, resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/auth/discord' }), (_, res) => res.redirect('/'));

app.use((req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.redirect('/auth/discord');
});

const upstream = `http://127.0.0.1:${process.env.SIYUAN_INTERNAL_PORT || 6807}`;
app.use('/', createProxyMiddleware({ target: upstream, changeOrigin: true, ws: true }));

const port = process.env.PORT || 6806;
app.listen(port, () => console.log('Proxy up on', port, '->', upstream));
