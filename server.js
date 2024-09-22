const express = require("express");
const { pool } = require("./dbConfig");
const bcrypt = require("bcrypt");
const passport = require("passport");
const flash = require("express-flash");
const session = require("express-session");
require("dotenv").config();
const path = require(`path`);
var bodyParser = require('body-parser')
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

const initializePassport = require("./passportConfig");
const { throws } = require("assert");
initializePassport(passport);

// Parses details from a form
app.use(express.urlencoded({ extended: false }));
app.use(bodyParser.json())

app.set("view engine", "ejs");

app.use(
  session({
    // Key we want to keep secret which will encrypt all of our information
    secret: process.env.SESSION_SECRET,
    // Should we resave our session variables if nothing has changes which we dont
    resave: false,
    // Save empty value if there is no vaue which we do not want to do
    saveUninitialized: false
  })
);
// Funtion inside passport which initializes passport
app.use(passport.initialize());
// Store our variables to be persisted across the whole session. Works with app.use(Session) above
app.use(passport.session());
app.use(flash());

app.set('case sensitive routing', true);

// Create a transporter object using custom SMTP settings
const transporter = nodemailer.createTransport({
  host: 'smtppro.zoho.eu',
  port: 587, 
  secure: false,
  auth: {
    user: 'master@ferminotify.me',
    pass: process.env.EMAIL_PASSWORD,
  },
});


app.get("/", async (req, res) => {
  if (req.isAuthenticated()) {
    res.render("index.ejs", { isLogged: true, user: await getUserName(req.user.email)});
  }else{
    res.render("index.ejs", { isLogged: false });
  }
});

app.get("/register", checkAuthenticated, (req, res) => {
  res.render("register.ejs");
});

app.get("/credits", (req, res) => {
  res.render("credits.ejs", { isLogged: req.isAuthenticated() });
});

app.get("/faq", (req, res) => {
  res.render("faq.ejs", { isLogged: req.isAuthenticated() });
});

app.get("/feedback", (req, res) => {
  res.render("forms/feedback.ejs", { isLogged: req.isAuthenticated() });
});

app.get("/recruiting", (req, res) => {
  res.render("forms/recruiting.ejs", { isLogged: req.isAuthenticated() });
});

app.get("/login", checkAuthenticated, (req, res) => {
  // flash sets a messages variable. passport sets the error message
  if (req.session.flash != undefined && req.session.flash.error != undefined){
    console.log("ERR LOG IN: " + req.session.flash.error);
    // temp fix TODO
    req.flash("error_msg", req.session.flash.error);
  }
  res.render("login.ejs");
});

app.get("/dashboard", checkNotAuthenticated, async (req, res) => {

  let name = await getUserName(req.user.email);
  let lastname = await getUserLastName(req.user.email);
  let keywords = await getUserKeywords(req.user.email);
  let telegram = await getUserTelegram(req.user.email);
  let notifications = await getUserNotifications(req.user.email);
  let gender = await getUserGender(req.user.email);
  let notificationPreferences = await getUserNotificationPreferences(req.user.email);

  console.log("SUCCESS LOG IN: " + req.user.email + " - kw: " + keywords);

  res.render("dashboard", { 
    user: name,
    lastname: lastname,
    keywords: keywords,
    tgun: telegram,
    n_not: notifications,
    gender: gender,
    n_pref: notificationPreferences,
    email: req.user.email,
  });
});

app.get("/password_reset", (req, res) => {
  res.render("password_reset.ejs", { isLogged: req.isAuthenticated() });
});

app.get("/logout", (req, res, next) => {
  req.logout(function(err){
    if (err) { return next(err); }
  });
  res.redirect("/");
});

app.get("/users/register/confirmation/:id", async (req, res, next) => {
  let userId = req.params.id;

  let email = await getUserEmailWithTelegramID(userId);
  if(email == undefined){
    req.flash("error_msg", "Link di conferma non valido!");
    console.log("ERR CONFIRMATION " + userId + ": email not found");
    return res.redirect("/login");
  }
  if(await getNumberNotification(email) > -1){
    req.flash("error_msg", "Account già confermato! Fai il login per accedere.");
    return res.redirect("/login");
  }
  const a = await incrementNumberNotification(userId);
  
  // set classe kw
  let classe_kw = await getUserClass(email);
  
  if (classe_kw != null) { 
    pool.query(
      `UPDATE subscribers
        SET tags = array_cat(tags, $1)
        WHERE email = $2;`,
      [classe_kw, email],
      (err, results) => {
        if (err) {
          console.log("ERR CONFIRMATION ADD CLASSE KW " + email + ": " + err);
          throw err;
        } else {
          console.log("SUCCESS CONFIRMATION ADD CLASSE KW TO " + email + ": " + classe_kw);
        }
      }
    );
  } else {
    console.log("WARN CONFIRMATION ADD CLASSE KW " + email + ": classe_kw (" + classe_kw + ") not found");
  }

  res.redirect("/login");
});

async function getUserEmailWithTelegramID(telegramId) {
  try {
    const RES = await pool.query(
      `SELECT email FROM subscribers
        WHERE telegram = '${telegramId}'`,
    );
    return RES.rows[0].email;
  } catch (err) {
    console.log("ERR GET EMAIL WITH TG ID " + telegramId + ": " + err.stack);
  }
}
async function getUserClass(email){
  let name = await getUserName(email);
  name = name.toString().trim().toUpperCase();

  let lastname = await getUserLastName(email);
  lastname = lastname.toString().trim().toUpperCase();

  var fermiapi_getClass_url = `https://fermiapi.kliu.win/get-class?firstname=${name}&lastname=${lastname}`;

  let classe = await getClasse(fermiapi_getClass_url);

  if(classe == null) return null;

  let classes = [];

  // es. 5E ELE (5E ELE ET)
  if(classe.includes('(') && classe.includes(')')) {
    classes.push(classe.match(/^[^\(]+/)[0]); // fuori parentesi
    classes.push(classe.match(/\((.*?)\)/)[1]); // dentro parentesi
  }else{
    classes.push(classe); // senza parentesi
  }

  console.log(`GET CLASSE ${email}: ${name},${lastname}: ${classes} (from ${fermiapi_getClass_url})`);

  return classes;
}
  
const http = require('http');
const https = require('https');

async function getClasse(url) {
  let classe = new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    protocol.get(url, (response) => {
      let data = '';

      // A chunk of data has been received.
      response.on('data', (chunk) => {
        data += chunk;
      });

      // The whole response has been received.
      response.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          if (jsonData.students.length == 1) {
            resolve(jsonData.students[0].classe.toUpperCase());
          } else if (jsonData.students.length > 1) {
            console.log("ERR GET CLASSE: more than one student found");
            resolve(null);
          } else {
            console.log("ERR GET CLASSE: " + jsonData.error + " " + jsonData.description);
            resolve(null);
          }
        } catch (error) {
          console.error("ERR GET CLASSE PARSING JSON: ", error);
          resolve(null);
        }
      });
    }).on('error', (error) => {
      console.error("ERR GET CLASSE DATA: ", error);
      resolve(null);
    });
  });
  // remove spaces (it can happen that the space is in between es. 5I TEL)
  classe = await classe;
  if(classe != null) classe = classe.replace(/\s/g, '');
  return classe;
}

app.post("/users/register", async (req, res) => {
  let { name, surname, email, password, password2, gender } = req.body;

  name = name.trim();
  surname = surname.trim();

  let errors = [];

  if (!name || !surname || !email || 
      !password || !password2 || 
      !gender) {
    errors.push({ message: "Compila tutti i campi!" });
  }

  if (password.length < 6) {
    errors.push({ message: "La password deve essere lunga almeno 6 caratteri!" });
  }

  if (password !== password2) {
    errors.push({ message: "Le password non corrispondono!" });
  }

  if (errors.length > 0) {
    res.render("register", { errors, name, email, password, password2 });
    return;
  } 

  // If no errors runs as it follows
  hashedPassword = await bcrypt.hash(password, 10);
  telegramTemporaryCode = await getTelegramTemporaryCode();
  pool.query(
    `SELECT * FROM subscribers
      WHERE email = $1`,
    [email],
    (err, results) => {
      if (err) {
        console.log("ERR REGISTER " + email + ": " + err);
      }

      if (results.rows.length > 0) {
        errors.push({ message: "Email già registrata!" });
        res.render("register.ejs", { errors });
      } else {
        pool.query(
          `INSERT INTO subscribers (name, surname, email, password, notifications, telegram, gender, notification_preferences)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id, password`,
          [name, surname, email, hashedPassword, -2, telegramTemporaryCode, gender, 2],
          (err, results) => {
            if (err) {
              throw err;
            } else {
              console.log("SUCCESS REGISTER WAITING FOR CONFIRMATION: " + email + " - " + telegramTemporaryCode);
            }
            req.flash("success_msg", "Ti abbiamo inviato una mail per confermare l'account! (controlla anche lo SPAM)");
            res.redirect("/login");
          }
        );
      }
    }
  );
});


app.post("/user/request-change-password", async (req, res) => { // PWD-CNG #1
  let { user_email } = req.body;
  
  let errors = [];

  let name = await getUserName(user_email);

  const randomCode = Math.random().toString(36).substring(2, 8).toUpperCase(); // 6 char long
  
  pool.query(
    `UPDATE subscribers
      SET secret_temp = $1, secret_temp_timestamp = CURRENT_TIMESTAMP
      WHERE email = $2;`,
    [randomCode, user_email],
    (err, result) => {
      if (err) {
        errors.push({ message: "Si è verificato un errore! Riprova più tardi." });
        res.render("password_reset.ejs", { errors, isLogged : req.isAuthenticated()}); // GET NOT RENDER TODO
        throw err;
      }

      const mailOptions = {
        from: 'Fermi Notify Team <master@ferminotify.me>',
        to: user_email,
        subject: `Codice di sicurezza OTP [${randomCode}]`,
        html: `<!DOCTYPE html><html><body><main style="font-family:Helvetica,Arial,Liberation Serif,sans-serif;background-color:#fff;color:#000;"><table style="max-width:620px;border-collapse:collapse;margin:0 auto 0 auto;text-align:center;font-family:Helvetica,Arial,Liberation Serif,sans-serif;" width="620px" border="0" cellpadding="0" cellspacing="0"><tr style="background-color:#101010;background-image:url('https://ferminotify.me/img/email/2023/bgcolor.png');"><td style="width:100%;padding:30px 0;"><img src="https://ferminotify.me/img/email/2022/logo-long-white-trasp.png" style="width:80%;height:auto;color:#fff" alt="FERMI NOTIFY"></td></tr><tr style="background-color:#101010;background-image:url('https://ferminotify.me/img/email/2023/bgcolor.png');"><td><table style="width:100%;background-color:#fff;border:1px solid #e1e4e8;border-bottom:none;padding:30px 7% 15px 7%;border-top-left-radius:10px;border-top-right-radius:10px;border-bottom-left-radius:10px;border-bottom-right-radius:10px;" border="0" cellpadding="0" cellspacing="0"><tr><td><h1 style="margin:0;font-size:24px;">Il tuo codice di sicurezza</h1></td></tr><tr><td style="text-align:left;"><p style="margin-bottom:15px;font-size:16px;">Ciao ${name},<br>il tuo <b>codice di sicurezza OTP</b> &egrave;:</p><table style="margin-left:auto;margin-right:auto;padding:5px 0;text-align:center;border-radius:10px;"><tr><td><h1 style="margin:0;text-align:center;width:30px;font-size:24px">${randomCode[0]}</h1></td><td><h1 style="margin:0;text-align:center;width:30px;font-size:24px">${randomCode[1]}</h1></td><td><h1 style="margin:0;text-align:center;width:30px;font-size:24px">${randomCode[2]}</h1></td><td><h1 style="margin:0;text-align:center;width:30px;font-size:24px">${randomCode[3]}</h1></td><td><h1 style="margin:0;text-align:center;width:30px;font-size:24px">${randomCode[4]}</h1></td><td><h1 style="margin:0;text-align:center;width:30px;font-size:24px">${randomCode[5]}</h1></td></tr></table></td></tr><tr><td style="font-size:13px;text-align:center;"><p style="margin-bottom:15px;">Il codice scadr&agrave; tra <b>15 minuti</b>.<br>Ti inviamo questo codice perch&eacute; hai richiesto di cambiare la password del tuo account. Se non hai richiesto di cambiare la password, puoi ignorare questa email.</p></td></tr></table></td></tr><!-- footer --><tr style="background-color:#101010;"><td style="padding:30px 7%;font-size:13px;position:relative;background-image:url('https://ferminotify.me/IMG/email/2023/bgcolor.png');background-position:top;background-size:cover;background-color:#101010;"><p style="color:#aaa;">Per supporto o informazioni, rispondere a questa email o contattare <a href="mailto:master@ferminotify.me" style="color:#FF9800">master@ferminotify.me</a>.</p><p style="margin-top:30px;margin-bottom:0;color:#aaa;"><i style="color:#aaa;">Fermi Notify Team</i></p><p style="margin:0"><a href="mailto:master@ferminotify.me" style="color:#FF9800">master@ferminotify.me</a></p><p style="margin-top:0"><a href="https://www.ferminotify.me" target="_blank" style="color:#FF9800">www.ferminotify.me</a></p></td></tr></table></main></body></html>`,
      };
      
      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.log("ERR REQ CHANGE PSW: " + user_email + ": " + error);
          errors.push({ message: "Si è verificato un errore! Riprova più tardi." });
          res.render("password_otp.ejs", { errors, isLogged : req.isAuthenticated()});
        } else {
          console.log('SUCCESS REQ CHANGE PSW EMAIL SENT TO ' + user_email + ': ' + info.response);
          res.render("password_otp.ejs", { 
            isLogged: req.isAuthenticated(),
            user_email: user_email
          });
        }
      });
    }
  );
});


app.post("/user/otp-change-password", async (req, res) => { // PWD-CNG #2
  let { user_email, random_code } = req.body;

  let errors = [];

  pool.query(
    `SELECT * FROM subscribers
      WHERE email = $1;`,
    [user_email],
    async (err, results) => {
      if (err) {
        console.log("ERR OTP CHANGE PSW " + user_email + " " + random_code + ": " + err);
      }

      let codeGenerationTimestamp = results.rows[0].secret_temp_timestamp;      
      const timestamp = new Date(codeGenerationTimestamp);
      // Date.UTC bc the db is in the UTC timezone
      const now = new Date();
      const currentTime = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds());
      const timeDifference = currentTime.getTime() - timestamp.getTime();
      const fifteenMinutesInMilliseconds = 15 * 60 * 1000;

      if (timeDifference > fifteenMinutesInMilliseconds) {
        errors.push({ message: "Il codice OTP è scaduto!" });
        res.render("password_otp.ejs", { errors, user_email, isLogged : req.isAuthenticated()});
      }

      if (results.rows[0].secret_temp == random_code) { // Password change
        return res.render("password_new.ejs", { 
          random_code,
          isLogged: req.isAuthenticated(),
          user_email: user_email
        });
      } else {
        console.log("WARN OTP CHANGE PSW NOT CORRECT " + user_email + "; input: " + random_code + "; random_code: " + results.rows[0].secret_temp);
        errors.push({ message: "Il codice OTP non corrisponde!" });
        res.render("password_otp.ejs", { errors, user_email, isLogged : req.isAuthenticated()});
      }
    }
  );
});


app.post("/user/new-change-password", async (req, res) => { // PWD-CNG #3
  let { password, password2, user_email, random_code } = req.body;

  let errors = [];

  let email_otp_matches = pool.query(
    `SELECT * FROM subscribers
      WHERE email = $1;`,
    [user_email],
    async (err, results) => {
      if (err) {
        console.log("ERR NEW PSW " + user_email + " " + random_code + ": " + err);
      }

      // random_code is not the same for email
      if (results.rows[0].secret_temp != random_code) {
        console.log("ERR NEW PSW OTP DOES NOT MATCH EMAIL " + user_email + ": random_code" + random_code + "; " + "secret_temp: " + results.rows[0].secret_temp);
        req.flash("error_msg", "Si è verificato un errore! Riprova più tardi.");
        res.redirect("/password_reset");
        return 0;
      }
      return 1;
    }
  );

  if(!email_otp_matches) return;
  
  if (password != password2) {
    errors.push({ message: "Le password non corrispondono!" });
  }

  if (password.length < 6) {
    errors.push({ message: "La password deve essere lunga almeno 6 caratteri!" });
  }

  hashedPassword = await bcrypt.hash(password, 10);

  pool.query(
    `UPDATE subscribers
      SET password = $1, secret_temp = '', secret_temp_timestamp = NULL
      WHERE email = $2;`,
    [hashedPassword, user_email],
    (err, results) => {
      if (err) {
        errors.push({ message: "Si è verificato un errore! Riprova più tardi." });
        console.log("ERR NEW PASSWORD " + user_email + ": " + err);
      }else{
        console.log("SUCCESS NEW PASSWORD " + user_email);
        req.flash("success_msg", "Password cambiata con successo!");
        res.redirect("/login");
      }
    }
  );

  if (errors.length > 0) {
    res.render("password_new.ejs", { random_code, errors, user_email, isLogged : req.isAuthenticated()});
  }

});


app.post("/notification-preferences", async (req, res) => {
  let option;

  // I use not true because sometimes value can be also None 
  // or undefined
  if(req.body.email && req.body.telegram)
    option = 3;
  else if(req.body.email && !req.body.telegram)
    option = 2;
  else if(!req.body.email && req.body.telegram) 
    option = 1;
  else if(!req.body.email && !req.body.telegram) 
    option = 0;

  pool.query(
    `UPDATE subscribers
      SET notification_preferences = $1
      WHERE email = $2;`,
    [option, req.user.email],
    (err, results) => {
      if (err) {
        console.log("ERR NOTIFICATION PREF" + req.body.email + ": " + err);
        throw err;
      }
    }
  );
  res.redirect("/dashboard");
});

app.post("/keyword", async function (req, res) {
  /**
   * If the keyword has already been stored,
   * has to be removed.
   * If the keyword is not stored yet,
   * has to be appended.
   */
  let sentKeyword = req.body.keyword;
  let userKeywords = await getUserKeywords(req.user.email);

  sentKeyword = sentKeyword.trim(); // remove spaces from start, end
  sentKeyword = sentKeyword.toUpperCase(); // set all to uppercase

  let occurrences = 0;
  if(userKeywords != null){
    userKeywords.forEach(kw => {
      if(kw==sentKeyword) {
        occurrences=occurrences+1;
      }
    });
  }

  if(occurrences>0){
    pool.query(
      `UPDATE subscribers
        SET tags = array_remove(tags, $1)
        WHERE email = $2;`,
      [sentKeyword, req.user.email],
      (err, results) => {
        if (err) {
          console.log("ERR DEL KW " + req.user.email + ": " + err);
          throw err;
        }
      }
    );
  } else {
    pool.query(
      `UPDATE subscribers
        SET tags = array_append(tags, $1)
        WHERE email = $2;`,
      [sentKeyword, req.user.email],
      (err, results) => {
        if (err) {
          console.log("ERR ADD KW " + req.user.email + ": " + err);
          throw err;
        }
      }
    );
  }

  res.redirect("/dashboard");
});

app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/dashboard",
    failureRedirect: "/login",
    failureFlash: true
  })
);

app.post("/user/edit", async function (req, res) {
  try { var email = req.user.email; } catch (error) { console.log("ERR EDIT: " + error); return res.redirect("/dashboard"); }
  var name = req.body.firstname || await getUserName(email);
  var surname = req.body.lastname || await getUserLastName(email);
  var gender = req.body.gender !== undefined && req.body.gender.length === 1 ? req.body.gender : await getUserGender(email);

  name = name.trim();
  surname = surname.trim();

  if(name.length > 50 || surname.length > 50) {
    console.log("ERR EDIT " + email + ": name or surname too long");
    req.flash("error_msg", "Si è verificato un errore! Riprova più tardi.");
    return res.redirect("/dashboard");
  }

  try {
    await pool.query(
      `UPDATE subscribers
      SET name = $1, surname = $2, gender = $3
      WHERE email = $4`,
      [name, surname, gender, email]
    );

    console.log(`SUCCESS EDIT ${email}: new firstname = ${name}; new lastname = ${surname}; new gender = ${gender}`);
    res.redirect("/dashboard");
  } catch (error) {
    console.log('ERR EDIT' + email + ": " + error);
    req.flash("error_msg", "Si è verificato un errore! Riprova più tardi.");
    res.redirect("/dashboard");
  }
});

/* api for the planning of future events */
app.post(
  "/user/planning/", async (req, res) => {
    let id = req.body.id;
    let kw = await getUserKeywords(await getUserEmail(id));
    res.json({ id: id,  my_kw: kw });
});

// status check
app.get("/status", async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send("OK");
});

function checkAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return res.redirect("/dashboard");
  }
  next();
}

function checkNotAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect("/login");
}

async function getTelegramTemporaryCode() {
  /**
   * This function returns the code that
   * the user has to send to my bot on telegram.
   * 
   * When the bot get this code, register the 
   * telegram user id of the sender (my user).
   * 
   * This code is unique for every subscriber,
   * is generated with a $ at its beginning
   * and parts of the hashed email of the user.
   */
  let code = "X";

  code += (Math.random() + 1).toString(36).substring(6); // add random string of 7 char

  /**
   * VALIDATING CODE
   * Check if the code that I've just generated
   * is not yet associated with someone else.
   */
  allCodes = await getAllTelegram();
  if (allCodes != undefined){
    for(let i=0; i<allCodes.length;i++){
      if(allCodes[i] == code) {
        return getTelegramTemporaryCode(email + "LOL");
      }
    }
  }
  return code;
}

async function getUserName(user_email){
  try {
    const RES = await pool.query(
      `SELECT name FROM subscribers
        WHERE email = '${user_email}'`,
    );
    return RES.rows[0].name;
  } catch (err) {
    console.log("ERR GET USERNAME " + user_email + ": " + err.stack);
  }
}

async function getUserLastName(user_email){
  try {
    const RES = await pool.query(
      `SELECT surname FROM subscribers
        WHERE email = '${user_email}'`,
    );
    return RES.rows[0].surname;
  } catch (err) {
    console.log("ERR GET LAST NAME " + user_email + ": " + err.stack);
  }
}

async function getUserEmail(user_id) {
  try {
    const RES = await pool.query(
      `SELECT email FROM subscribers
        WHERE id = '${user_id}'`,
    );
    return RES.rows[0].email;
  } catch (err) {
    console.log("ERR GET EMAIL " + user_id + ": " + err.stack);
  }
}

async function getUserKeywords(user_email){
  try {
    const RES = await pool.query(
      `SELECT tags FROM subscribers
        WHERE email = '${user_email}'`,
    );
    return RES.rows[0].tags;
  } catch (err) {
    console.log("ERR GET KW " + user_email + ": " + err.stack);
  }
}

async function getAllTelegram() {
  try {
    const RES = await pool.query(
      `SELECT telegram FROM subscribers;`
    );
    return RES.rows[0].telegram;
  } catch (err) {
    console.log(err.stack);
  }
}

async function getUserTelegram(user_email){
  try {
    const RES = await pool.query(
      `SELECT telegram FROM subscribers
        WHERE email = '${user_email}'`
    );
    return RES.rows[0].telegram;
  } catch (err) {
    console.log("ERR GET TG " + user_email + ": " + err.stack);
  }
}

async function getUserNotifications(user_email){
  try {
    const RES = await pool.query(
      `SELECT notifications FROM subscribers
        WHERE email = '${user_email}'`,
    );
    return RES.rows[0].notifications;
  } catch (err) {
    console.log("ERR GET NOTIFICATIONS " + user_email + ": " + err.stack);
  }
}

async function getUserGender(user_email){
  try {
    const RES = await pool.query(
      `SELECT gender FROM subscribers
        WHERE email = '${user_email}'`,
    );
    return RES.rows[0].gender;
  } catch (err) {
    console.log("ERR GET GENDER " + user_email + ": " + err.stack);
  }
}

async function getUserNotificationPreferences(user_email) {
  try {
    const RES = await pool.query(
      `SELECT notification_preferences FROM subscribers
        WHERE email = '${user_email}'`,
    );
    return RES.rows[0].notification_preferences;
  } catch (err) {
    console.log("ERR GET NOTIFICATION PREF " + user_email + ": " + err.stack);
  }
}

async function incrementNumberNotification(telegramId){
  try {
    const RES = await pool.query(
      `UPDATE subscribers
         SET notifications = notifications + 1
       WHERE telegram = '${telegramId}' AND notifications = -1;`
    );
    console.log("SUCCESS CONFIRMATION TG ID: " + telegramId);
    return RES;
  } catch (err) {
    console.log("ERR ADD NORIFICATIONS " + telegramId + ": " + err.stack);
  }
}

async function getNumberNotification(email){
  try{
    const RES = await pool.query(
      `SELECT notifications FROM subscribers
        WHERE email = '${email}'`,
    );
    return RES.rows[0].notifications;
  } catch (err) {
    console.log("ERR GET NUMBER NOTIFICATIONS " + email + ": " + err.stack);
  }
}

/* set static folder for css etc */
app.use(express.static(path.join(__dirname, 'public')))

/* set up 404 page (not found) */
/* WARNING: This route has to be the last one!! */
//The 404 Route (ALWAYS Keep this as the last route)
app.get('*', function(req, res){
  res.render("404.ejs");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
