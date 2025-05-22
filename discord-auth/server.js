const express = require('express');
const session = require('express-session');
const dotenv = require('dotenv');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const { createProxyMiddleware } = require('http-proxy-middleware');

dotenv.config();

const {
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  DISCORD_CALLBACK_URL,
  SESSION_SECRET = 'keyboard cat',
  ALLOWED_GUILD_ID,
  ALLOWED_ROLE_ID
} = process.env;

if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !DISCORD_CALLBACK_URL) {
  console.error('Discord OAuth2 env vars missing');
  process.exit(1);
}

passport.serializeUser((u, d) => d(null, u));
passport.deserializeUser((u, d) => d(null, u));

passport.use(new DiscordStrategy(
  {
    clientID: DISCORD_CLIENT_ID,
    clientSecret: DISCORD_CLIENT_SECRET,
    callbackURL: DISCORD_CALLBACK_URL,
    scope: ['identify', 'guilds']
  },
  (access, refresh, profile, done) => done(null, profile)
));

const app = express();

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback',
  passport.authenticate('discord', { failureRedirect: '/auth/discord' }),
  (req, res) => res.redirect('/')
);

function authorised(req) {
  if (!req.user) return false;
  if (ALLOWED_GUILD_ID) {
    const inGuild = req.user.guilds?.some(g => g.id === ALLOWED_GUILD_ID);
    if (!inGuild) return false;
  }
  return true;
}

app.use((req, res, next) => {
  if (req.path.startsWith('/auth/discord')) return next();
  if (!req.isAuthenticated() || !authorised(req)) {
    return res.redirect('/auth/discord');
  }
  next();
});

const targetPort = process.env.SIYUAN_INTERNAL_PORT || 6807;
app.use('/', createProxyMiddleware({
  target: `http://127.0.0.1:${targetPort}`,
  changeOrigin: true,
  ws: true
}));

const port = process.env.PORT || 6806;
app.listen(port, () => console.log(`Proxy up on ${port} -> ${targetPort}`));
