// Discord OAuth2 reverse‑proxy for SiYuan
import express from 'express';
import session from 'express-session';
import dotenv from 'dotenv';
import passport from 'passport';
import { Strategy as DiscordStrategy } from 'passport-discord';
import { createProxyMiddleware } from 'http-proxy-middleware';

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
  console.error('Discord OAuth2 env vars missing. Exiting.');
  process.exit(1);
}

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy(
  {
    clientID: DISCORD_CLIENT_ID,
    clientSecret: DISCORD_CLIENT_SECRET,
    callbackURL: DISCORD_CALLBACK_URL,
    scope: ['identify', 'guilds', 'guilds.members.read']
  },
  (accessToken, refreshToken, profile, done) => done(null, profile)
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

function isAuthorised(req) {
  if (!req.user) return false;
  if (ALLOWED_GUILD_ID) {
    const guild = req.user.guilds?.find(g => g.id === ALLOWED_GUILD_ID);
    if (!guild) return false;
    if (ALLOWED_ROLE_ID) {
      const roles = guild.permissions_new?.roles || [];
      if (!roles.includes(ALLOWED_ROLE_ID)) return false;
    }
  }
  return true;
}

app.use((req, res, next) => {
  if (req.path.startsWith('/auth/discord')) return next();
  if (!req.isAuthenticated() || !isAuthorised(req)) {
    return res.redirect('/auth/discord');
  }
  next();
});

app.use('/', createProxyMiddleware({
  target: 'http://127.0.0.1:6806',
  changeOrigin: true,
  ws: true
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Auth proxy listening on ${PORT}`));
