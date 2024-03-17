const express = require('express');     
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const db = require('pg');
const sql = new db.Client({connectionString: 'postgres://postgres:rootroot@localhost:5432/support'});

(async function main() {  
  try {
    await sql.connect();
    const app = express();
    customization(app);
    routing(app);
    app.listen(80);
  }
  catch(error) {
    console.error('Error connecting to the database:', error.message);
  }
})();

function customization(app) {
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({extended: true}))
  app.use(cookieParser())
  app.use(express.static('templates/styles'))

  app.set("view engine", "ejs");
  app.set("views", "templates"); 
}

function routing(app) {

  app.post("/first", (req, res) => {
    const action = req.body.button;
    if (action === "auth") {
      res.redirect("/auth");
    }
    else if (action === "login") {
      res.redirect("/login");
    }
    else {
      res.send("The action is not defined");
    }
  });

  
  app.get("/admin", function (req, res) {
    checkAuth(req, res, async function (req, res, userId) {
      try {
        const problemsResult = await sql.query(`SELECT * FROM problems WHERE status = 0`);
        const problems = problemsResult.rows;

        const mastersResult = await sql.query(`SELECT * FROM users WHERE user_role = 'master'`);
        const masters = mastersResult.rows;

        const clientsInfo = [];
        for (const problem of problems) {
          const clientResult = await sql.query(`SELECT * FROM clients WHERE user_id = $1`, [problem.client_id]);
          const clientInfo = {
            fullname: clientResult.rows[0].client_fullname,
            phone: clientResult.rows[0].client_phone
          };
          clientsInfo.push(clientInfo);
        }
      
        res.render("admin", {problems, masters, clientsInfo}); 
      } catch(error) {
        res.status(500).send("Internal Server Error");
      } 
    })
  });

  app.get("/master", function (req, res) {
    checkAuth(req, res, async function (req, res, userId) {
      try {
        const problemsResult = await sql.query(`SELECT * FROM problems WHERE master_id = $1 AND status = 1`, [userId]);
        const problems = problemsResult.rows;

        const resultMaster = await sql.query(`SELECT * FROM users WHERE user_id = $1`, [userId]);
        const loginMaster = resultMaster.rows[0].user_login;

        const clientsInfo = [];
        for (const problem of problems) {
          const clientResult = await sql.query(`SELECT * FROM clients WHERE user_id = $1`, [problem.client_id]);
          const clientInfo = {
            fullname: clientResult.rows[0].client_fullname,
            phone: clientResult.rows[0].client_phone
          };
          clientsInfo.push(clientInfo);
        }

        res.render("master", {loginMaster, problems, clientsInfo});
      } catch(error) {
        res.status(500).send("Internal Server Error");
      }
    })
  });

  app.get("/client", function (req, res) {
    checkAuth(req, res, async function (req, res, userId) {
      try {
        const problemsResult = await sql.query(`SELECT * FROM problems WHERE client_id = $1 ORDER BY status`, [userId]);
        const problems = problemsResult.rows;

        const resultClient = await sql.query(`SELECT * FROM clients WHERE user_id = $1`, [userId]);
        const fullname = resultClient.rows[0].client_fullname;
        res.render("client", {fullname, problems});
      } catch(error) {
        res.status(500).send("Internal Server Error");
      }
    })
  });



  app.get("/logout", function (req, res) {
    res.clearCookie("token");
    res.redirect("/login");   
  });

  app.get("/login", function (req, res) {
    res.render("login");    
  });

  app.get("/first", function (req, res) {
    res.render("first");
  });

  app.get("/auth", function (req, res) {
     res.render("auth");
  });



  app.post("/registration", async function (req, res) {
    const {fullname, login, password, phone} = req.body;

    try {
      const user = await sql.query(`
      INSERT INTO users (user_login, user_password, user_role) 
      VALUES ($1, $2, $3) RETURNING user_id`, 
      [login, password, 'client']);

      await sql.query(`
      INSERT INTO clients (user_id, client_fullname, client_phone)
      VALUES ($1, $2, $3)`,
      [user.rows[0].user_id, fullname, phone]);
     
      res.redirect("/login");
    } catch(error) {
      res.status(500).send("Ошибка при регистрации");
    }
  });



  app.post("/login", async function (req, res) {
    const {username, password} = req.body;
    
    try {
      const result = await sql.query(`
      SELECT * FROM users WHERE user_login = $1 AND user_password = $2;
      `, [username, password]);

      if (result.rows.length === 0) {
        res.status(400).send("Логин или пароль неверны!");
        return;
      }
      
      const user = result.rows[0];
      const role = user.user_role;
      const id = user.user_id;
      
      const token = jwt.sign({userId: id}, 'secret_key');
      
      res.cookie('token', token);
      res.redirect("/" + role);
    } catch (error) {
      res.status(500).send("Internal Server Error");
    }
  });



  app.post("/createproblem", function (req, res) {
    checkAuth(req, res, function(req, res, userId) {
      const problemDescription = req.body.problemDescription;
      sql.query(`INSERT INTO problems (client_id, description) VALUES ($1, $2)`, 
      [userId, problemDescription])
      .then(() => res.redirect("client"))
      .catch(error => {res.status(500).send("Internal Server Error")})
    });
  });



  app.post("/assignmaster", function (req, res) {
    checkAuth(req, res, function(req, res, userId) {
      const {master_id, problem_id} = req.body; 
      sql.query(`UPDATE problems SET master_id = $1, status = 1 WHERE problem_id = $2`, 
      [master_id, problem_id])
      .then(() => res.redirect("admin"))
      .catch(error => {res.status(500).send("Internal Server Error");})
    });
  });

  

  app.post("/solveproblem", function (req, res) {
    checkAuth(req, res, function(req, res, userId) {
      const {comment, problem_id} = req.body;
      sql.query(`UPDATE problems SET status = 2, comment = $1 WHERE problem_id = $2`, 
      [comment, problem_id])
      .then(() => res.redirect("master"))
      .catch(error => {res.status(500).send("Internal Server Error")})      
    });
  });


}


function checkAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) {
    res.redirect('/login');
    return;
  } 
  try {
    const decoded = jwt.verify(token, 'secret_key');
    next(req, res, decoded.userId);
  } catch (error) {
    res.redirect('/login');
  }
}

