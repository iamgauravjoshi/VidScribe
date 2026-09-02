import dotenv from "dotenv";

dotenv.config({
    path: "../.env",
});

export const config = {
	// Server
	node_env: process.env.NODE_ENV,
	port: Number(process.env.BACKEND_PORT),

    // PostgreSQL
    postgres: {
        host: process.env.POSTGRES_HOST,
        port: Number(process.env.POSTGRES_PORT),
        database: process.env.POSTGRES_DB,
        user: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD,
    },

    // JWT
	jwt: {
		secret: process.env.JWT_SECRET,
		expiresIn: process.env.JWT_EXPIRES_IN,
	},

    cookie: {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		expiresIn: 24 * 60 * 60 * 1000,
	},
}