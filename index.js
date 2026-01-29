import 'dotenv/config';
import app from './src/app.js';
import { connectDB } from './src/db/index.js';

const PORT = Number(process.env.PORT) || 3000;

connectDB().then(() => {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}).catch((err) => {
    console.log(err);
    process.exit(1);
});