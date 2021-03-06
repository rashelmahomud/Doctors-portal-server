const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { verify } = require('jsonwebtoken');
require('dotenv').config();
const port = process.env.PORT || 5000;
const app = express();
const stripe = require('stripe')(process.env.STRIPE_SICRET_KEY); //This is a payment method key

//middleware

app.use(cors());
app.use(express.json());



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ejkug.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });


//veryfy JWT starte here 
function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: 'Unauthorized access' })
    }
    const token = authHeader.split(" ")[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'accessToken forbiden' })
        }

        req.decoded = decoded;
        next();
    });
}
//veryfy JWT ends here 


//========Payment related code started here ============>

app.post('/create-payment-intent', verifyJWT, async (req, res) => {
    const service = req.body;
    const price = service.price;
    const amount = price * 100;
    const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card']
    });
    res.send({
        clientSecret: paymentIntent.client_secret
    });

})

//========Payment related code Ends here ===============^


async function run() {
    try {
        await client.connect();

        const serviceCollections = client.db('doctors_portal').collection('services');
        const bookingCollection = client.db('doctors_portal').collection('bookings');
        const userCollection = client.db('doctors_portal').collection('users');
        const doctorCollection = client.db('doctors_portal').collection('doctors');
        const paymentCollection = client.db('doctors_portal').collection('payments');


        //=======VeryFy for Admin Started===========>=============

        const veryfyAdmin = async (req, res, next) => {
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: requester });
            if (requesterAccount.role === 'admin') {
                next();
            } else {
                res.status(403).send({ message: 'forbidden' });
            }
        }
        //=======VeryFy for Admin Ends===========^=============



        app.get('/service', async (req, res) => {
            const query = {};
            const cursor = serviceCollections.find(query).project({ name: 1 });   //ai line ar .project({name: 1}) aita extra doctor ar jonno pora kora.
            const services = await cursor.toArray();
            res.send(services);
        });


        // All youser data sent started code here  
        app.get('/user', verifyJWT, async (req, res) => {
            const users = await userCollection.find().toArray();
            res.send(users);
        })
        // All youser data sent Ends code here

        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email: email });
            const isAdmin = user.role === 'admin';
            res.send({ admin: isAdmin });
        })


        // new user count in data base start here===
        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
                $set: user,
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })
            res.send({ result, token });
        })
        // new user count in data base ends here===


        // new Make a Admin in data base start here===
        app.put('/user/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: requester });
            if (requesterAccount.role === 'admin') {

                const filter = { email: email };
                const updateDoc = {
                    $set: { role: 'admin' },
                };
                const result = await userCollection.updateOne(filter, updateDoc);
                res.send(result);
            }
            else {
                res.status(403).send({ message: 'forbidden' });
            }
        })
        // new Make a Admin in data base ends here===


        //=======================
        // use data remove in all data
        app.get('/available', async (req, res) => {
            const date = req.query.date;
            // step 1: get all services
            const services = await serviceCollections.find().toArray();
            // step 2: get the booking of that day
            const query = { date: date };
            const bookings = await bookingCollection.find(query).toArray();

            // step 3: for each service, find bookings for that service

            services.forEach(service => {
                const serviceBookings = bookings.filter(book => book.treatment === service.name);
                const bookedSlots = serviceBookings.map(book => book.slot);
                const available = service.slots.filter(slot => !bookedSlots.includes(slot));
                service.slots = available;
            });

            res.send(services);
        })

        //=================

        // app.get('/booking', async(req,res) => {
        //     const patient = req.query.patient;
        //     const query = { patient: patient };
        //     const bookings = await bookingCollection.find(query).toArray();
        //     res.send(bookings);
        // })

        app.get('/booking', verifyJWT, async (req, res) => {
            const patient = req.query.patient;
            const decodedEmail = req.decoded.email;
            if (patient === decodedEmail) {
                const query = { patient: patient };
                const bookings = await bookingCollection.find(query).toArray();
                return res.send(bookings);
            } else {
                return res.status(403).send({ message: "forbiden access" })
            }

        });


        //===============Payment set server and Customer all info==Started=========>

        app.patch('/booking/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const payment = req.body;
            const filter = { _id: ObjectId(id)};
            updateDoc = {
                $set: {
                    paid: true,
                    transetionId: payment.transetionId
                }
            }

            const result = await paymentCollection.insertOne(payment);
            const updatedBooking = await bookingCollection.updateOne(filter, updateDoc);
            res.send(updateDoc);


        })

        //===============Payment set server and Customer all info=====Ends==========^




        //=======booking for cutomers payment =========>
        app.get('/booking/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const booking = await bookingCollection.findOne(query);
            res.send(booking);
        })
        //=======Booking for cutomer payment ^===========

        // app.get('/booking', async(req,res) => {
        //     const query = {};
        //     const bookings = await bookingCollection.find(query).toArray();
        //     res.send(bookings);
        // })

        app.post('/booking', async (req, res) => {
            const booking = req.body;
            const query = { treatment: booking.treatment, date: booking.date, patient: booking.patient }
            const excist = await bookingCollection.findOne(query);
            if (excist) {
                return res.send({ success: false, booking: excist })
            }
            const result = await bookingCollection.insertOne(booking);
            return res.send({ success: true, result });
        });

        // use data remove in all data


        //=========All Doctors Loaded code here started here==>==========
        app.get('/doctor', verifyJWT, veryfyAdmin, async (req, res) => {
            const doctors = await doctorCollection.find().toArray();
            res.send(doctors);
        })
        //=========All Doctors Loaded code here Ends here=====^=======


        //==========Delete for Doctor Started here==============>=====
        app.delete('/doctor/:email', verifyJWT, veryfyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = ({ email: email });
            const result = await doctorCollection.deleteOne(filter);
            res.send(result);

        })
        //==========Delete for Doctor Ends here==============^=====

        // Doctors all data set started here
        app.post('/doctor', verifyJWT, veryfyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorCollection.insertOne(doctor);
            res.send(result);

        })
        // Doctors all data set Ends here



    }
    finally {

    };
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Running this website');
});

app.listen(port, () => {
    console.log('lisining to port', port);
});