import express from "express"
import cors from "cors"
import 'dotenv/config'
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";
import jwt from 'jsonwebtoken';
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY) ; 
const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.rvz6g.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

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

        const menuCollection = client.db("bistro-boss").collection("menu");
        const usersCollection = client.db("bistro-boss").collection("users");
        const reviewsCollection = client.db("bistro-boss").collection("reviews");
        const cartsCollection = client.db("bistro-boss").collection("carts");
        const paymentsCollection = client.db("bistro-boss").collection("payments")

        // JWT related APIs
        app.post("/jwt" , async (req , res) => {
            const user = req.body ;
            const token = jwt.sign(user , process.env.ACCESS_TOKEN_SECRET , {expiresIn : "1h"}) ; 
            res.send({token})
        })


        // Middleware to verify to token and admin

        const verifyTOken = (req , res , next) => {
            // console.log(req.headers.authorization) ; 
            if(!req.headers.authorization){
                return res.status(401).send({message : "Unauthorized Access"});
            }
            const token = req.headers.authorization.split(" ")[1] ;
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET , (err,decoded) => {
                if(err){
                    return res.status(401).send({message : "Unauthorized Access" })
                }
                req.decoded = decoded ;
                next() ;
            }) 
          
        } ;

    //    use verify Admin After Verify Token
        const verifyAdmin =  async (req , res , next) => {
            const email = req.decoded.email ;
            const filter = {email : email} ; 
            const user = await usersCollection.findOne(filter) ;
            const isAdmin = user?.role === "admin" ;
            if(!isAdmin){
                return res.status(403).send({message : "Forbidden Access"})
            } ;

            next() ;
        }

        // Users Related APIs 

        app.get("/users", verifyTOken , verifyAdmin , async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        });

        app.get("/users/admin/:email" , verifyTOken ,async (req , res) => {
              const email = req.params.email ; 
              if(email !== req.decoded.email){
                return res.status(403).send({message : "Forbidden Access"})
              }
              const query = {email : email} ;
              const user = await usersCollection.findOne(query) ; 

              let admin = false ;
              if(user){
                admin = user?.role === "admin" 
              }
              res.send({admin}) ;
        })

        app.post("/users", async (req, res) => {
            const user = req.body;
            const filter = { email: user.email };
            const existingUser = await usersCollection.findOne(filter);
            if (existingUser) {
                res.send({ message: "User Already Exists", insertedId: null })
            }
            else {
                const result = await usersCollection.insertOne(user);
                res.send(result);
            }

        });

        app.patch("/users/admin/:id" , verifyTOken , verifyAdmin , async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            // const options = {upsert : true}
            const updatedDoc = {
                $set: {
                    role: "admin"
                }
            }

            const result = await usersCollection.updateOne(filter , updatedDoc ) ;
            res.send(result) ;
        })

        app.delete("/users/:id", verifyTOken , verifyAdmin , async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const result = await usersCollection.deleteOne(filter);
            res.send(result);
        });


        // Menu Related APIs
        app.get("/menu", async (req, res) => {
            const result = await menuCollection.find().toArray();
            res.send(result)
        });

        app.post("/menu" , verifyTOken , verifyAdmin,  async (req , res) => {
            const menuItem = req.body ;
            const result = await menuCollection.insertOne(menuItem);
            res.send(result) ; 
        }) ;

        app.get("/menu/:id" , async (req , res) => {
            const id = req.params.id ; 
            const filter = {_id : new ObjectId(id)} ;
            const result = await menuCollection.findOne(filter) ;
            res.send(result) ;
        }) ; 

        app.patch("/menu/:id" , async (req , res ) => {
            const item = req.body
            const id = req.params.id ;
            const filter = {_id : new ObjectId(id)} ;
            const updatedDoc = {
                $set : {
                   name : item.name ,
                   category : item.category ,
                   price : item.price , 
                   recipe : item.recipe ,
                   image : item.image
                }
            }
            const result = await menuCollection.updateOne(filter , updatedDoc) ;
            res.send(result)
        })


        app.delete("/menu/:id" , verifyTOken , verifyAdmin , async (req , res) => {
            const id = req.params.id ;
            const filter = {_id : new ObjectId(id)} ; 
            const result = await menuCollection.deleteOne(filter) ;
            res.send(result) ;
        }) ;

     



        // Reviews Related APIs

        app.get("/reviews", async (req, res) => {
            const result = await reviewsCollection.find().toArray();
            res.send(result)
        })


        // Carts Related APIs

        app.get("/carts", async (req, res) => {
            const email = req.query.email;
            const filter = { userEmail: email }
            const result = await cartsCollection.find(filter).toArray();
            res.send(result)
        })


        app.post("/carts", async (req, res) => {
            const cartItem = req.body;
            const result = await cartsCollection.insertOne(cartItem);
            res.send(result);
        })

        app.delete("/carts/:id", async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const result = await cartsCollection.deleteOne(filter);
            res.send(result);
        })


        // payment intent related APIs

        app.post("/create-payment-intent" , async (req , res) => {
            const {price} = req.body ;
            if (!price || isNaN(price) || price <= 0) {
                return res.status(400).send({ error: "Invalid or missing price. Must be greater than zero." });
              }
            const amount = parseInt(price*100) ;
            console.log(amount , "amount Inside the intent")
            const paymentIntent = await stripe.paymentIntents.create({
                amount : amount ,
                currency : "usd",
                payment_method_types: ["card"] ,
            })

            res.send({
                clientSecret : paymentIntent.client_secret
            })
        })

        // payment related APIs to send in DB

        app.get("/payments/:email" , verifyTOken , async (req , res) => {
            const filter = {email : req.params.email} ;
            if(req.params.email !== req.decoded.email){
              return res.status(403).send( { message : "Forbidden - Access"} )
            }
            const result = await paymentsCollection.find(filter).toArray() ;
            res.send(result) ;
        })

        app.post("/payments" , async (req , res) => {
            const newPayment = req.body ;
            const result = await paymentsCollection.insertOne(newPayment); 

            // carefully delete each item from the cart
            console.log("payment Info" , newPayment);
            const query = {_id : {
                $in : newPayment.cartIds.map(id => new ObjectId(id))
            }} ; 

            const deleteResult = await cartsCollection.deleteMany(query) ;
            res.send({result , deleteResult}) ;
        })

        // Stats and analytics 

        app.get("/admin-stats" , verifyTOken , verifyAdmin ,async(req , res) => {
            const users = await usersCollection.estimatedDocumentCount();
            const menuItems = await menuCollection.estimatedDocumentCount() ;
            const orders = await paymentsCollection.estimatedDocumentCount() ;
            const payments = await paymentsCollection.find().toArray();

            // this is not the best way
            // const revenue = payments.reduce((accumulator , payment) => accumulator + payment.price ,0) ;

            const result = await paymentsCollection.aggregate([{
                $group : {
                    _id : null ,
                    totalRevenue : {
                        $sum : "$price"
                    }
                }
            }]).toArray();

            const revenue = result.length > 0 ? result[0].totalRevenue : 0 ;

            res.send({users,menuItems ,orders , revenue}) ;
        }) ;



        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get("/", (req, res) => {
    res.send("boss is Running ")
})

app.listen(port, () => {
    console.log(`boss is sitting on ${port}`)
})