const express = require('express');
const app =express();
const cors = require('cors');
const jwt = require('jsonwebtoken');
const nodemailer = require("nodemailer");
const mg = require('nodemailer-mailgun-transport');
require('dotenv').config();
// to do : fixed the --api not found error------
const stripe =require('stripe')(process.env.PAYMENT_SECRET_KEY)
const port = process.env.PORT || 5000;


// middleware
app.use(cors());
app.use(express.json())

// let transporter = nodemailer.createTransport({
//   host: 'smtp.sendgrid.net',
//   port: 587,
//   auth: {
//       user: "apikey",
//       pass: process.env.SENDGRID_API_KEY
//   }
// })
const auth = {
  auth: {
    api_key: process.env.EMAIL_PRIVATE_KEY,
    domain: process.env.EMAIL_DOMAIN
  }
}

const transporter = nodemailer.createTransport(mg(auth));

//send confirmation email
const sendPaymentConfirmationEmail=payment =>{
  transporter.sendMail({
    from: "sabitameem578@gmail.com", // verified sender email
    to: "sabitameem578@gmail.com", // recipient email
    subject: "Your order is confirmed.Enjoy the food.", // Subject line
    text: "Hello world!", // plain text body
    html: `<div>
    <h2>Payment confirmed!!!</h2>
    <p>Transaction Id : ${payment.transactionId}</p>
    </div>`, // html body
  }, function(error, info){
    if (error) {
      console.log(error);
    } else {
      console.log('Email sent: ' + info.response);
    }
  });

}

// console.log(process.env.PAYMENT_SECRET_KEY)


const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).send({ error: true, message: 'unauthorized access' });
  }
  // bearer token
  const token = authorization.split(' ')[1];

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ error: true, message: 'unauthorized access' })
    }
    req.decoded = decoded;
    next();
  })
}





const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.sgocvky.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const usersCollection = client.db("bistroDb").collection("users");
    const menuCollection =client.db("bistroDb").collection("menu");
    const reviewsCollection =client.db("bistroDb").collection("reviews");
    const cartCollection =client.db("bistroDb").collection("carts");
    const paymentCollection = client.db("bistroDb").collection("payments");
    
    //token created
    app.post('/jwt', (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '30d' })

      res.send({ token })
    })



   // Warning: use verifyJWT before using verifyAdmin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email }
      const user = await usersCollection.findOne(query);
      if (user?.role !== 'admin') {
        return res.status(403).send({ error: true, message: 'forbidden message' });
      }
      next();
    }





    //users
    app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });




    app.post ('/users',async(req,res)=>{
       const user = req.body;
       const query = { email: user.email }
      const existingUser = await usersCollection.findOne(query);
       console.log(existingUser)
      if (existingUser) {
        return res.send({ message: 'user already exists' })
      }
       const result = await usersCollection.insertOne(user);
       res.send(result)
    })

    // security layer: verifyJWT
    // email same
    // check admin
    app.get('/users/admin/:email', verifyJWT, async (req, res) => {
      const email = req.params.email;

      if (req.decoded.email !== email) {
        res.send({ admin: false })
      }

      const query = { email: email }
      const user = await usersCollection.findOne(query);
      const result = { admin: user?.role === 'admin' }
      res.send(result);
    })


    app.patch('/users/admin/:id', async (req, res) => {
      const id = req.params.id;
      console.log(id);
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: 'admin'
        },
      };

      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);

    })



     // payment related api
     app.post('/payments', verifyJWT, async (req, res) => {
      const payment = req.body;
      const insertResult = await paymentCollection.insertOne(payment);
      const query = { _id: { $in: payment.cartItems.map(id => new ObjectId(id)) } }
      const deleteResult = await cartCollection.deleteMany(query)

      //send an email confirming payment
      sendPaymentConfirmationEmail(payment)






      res.send({ insertResult, deleteResult });
     })


     app.get('/admin-stats',verifyJWT,verifyAdmin, async(req,res)=>{
      const users = await usersCollection.estimatedDocumentCount();
      const products = await menuCollection.estimatedDocumentCount();
      const orders = await paymentCollection.estimatedDocumentCount();
      const payments = await paymentCollection.find().toArray();
      const revenue = payments.reduce( ( sum, payment) => sum + payment.price, 0)


      res.send({
        revenue,
        users,
        products,
        orders
      })
     })


     app.get('/order-stats',verifyJWT,verifyAdmin, async(req,res)=>{
      const pipeline = [
        {
          $lookup: {
            from: 'menu',
            localField: 'menuItems',
            foreignField: '_id',
            as: 'menuItemsData'
          }
        },
        {
          $unwind: '$menuItemsData'
        },
        {
          $group: {
            _id: '$menuItemsData.category',
            count: { $sum: 1 },
            total: { $sum: '$menuItemsData.price' }
          }
        },
        {
          $project: {
            category: '$_id',
            count: 1,
            total: { $round: ['$total', 2] },
            _id: 0
          }
        }
      ]

      const result = await paymentCollection.aggregate(pipeline).toArray()
      res.send(result)
     })




    //menu data
    app.get('/menu', async(req,res)=>{
        const result =await menuCollection.find().toArray();
        res.send(result);
    })

    app.post('/menu', verifyJWT, verifyAdmin, async (req, res) => {
      const newItem = req.body;
      const result = await menuCollection.insertOne(newItem)
      res.send(result);
    })

    // app.delete('/menu/:id', verifyJWT, verifyAdmin, async (req, res) => {
    //   const id = req.params.id;
    //   const query = { _id: new ObjectId(id) }
    //   const result = await menuCollection.deleteOne(query);
    //   res.send(result);
    // })

    app.delete('/menu/:id',verifyJWT,verifyAdmin, async (req,res)=>{
      const id= req.params.id;
      const query={$or:[{_id:new ObjectId(id)},{_id:id}]}
      const result = await menuCollection.deleteOne(query);
      res.send(result) 
    })

    //reviews data
    app.get('/reviews', async(req,res)=>{
        const result =await reviewsCollection.find().toArray();
        res.send(result);
    })

  // cart collection apis
  
    // cart collection apis
    app.get('/carts', verifyJWT, async (req, res) => {
      const email = req.query.email;

      if (!email) {
        res.send([]);
      }

      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        return res.status(403).send({ error: true, message: 'forbidden access' })
      }

      const query = { email: email };
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });

  app.post('/carts', async (req, res) => {
    const item = req.body;
    console.log(item);
    const result = await cartCollection.insertOne(item);
    res.send(result);
  })

  app.delete('/carts/:id',async (req,res) =>{
     const id =req.params.id;
     const query = { _id : new ObjectId(id)}
     const result = await cartCollection.deleteOne(query);
     res.send(result);
  })




  //payment related
   app.post("/create-payment-intent",verifyJWT, async(req,res)=>{
      const { price } = req.body;
      console.log(price)
       const amount = parseInt(price * 100);
       const paymentIntent = await stripe.paymentIntents.create({
        amount:amount,
        currency: 'usd',
        payment_method_types:['card']
       })
       res.send({
        clientSecret: paymentIntent.client_secret
       })
  //     const paymentIntent = await stripe.paymentIntents.create({
  //       amount: amount,
  //       currency: 'usd',
  //       payment_method_types: ['card']
  //     })
  //     res.send({
  //       clientSecret: paymentIntent.client_secret
  //     })


   })






    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);



app.get('/', (req,res)=>{
    res.send('Welcome hello')
})

app.listen(port,()=>{
    console.log(`bistro boss ${port}`)
})