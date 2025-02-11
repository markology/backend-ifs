require('dotenv').config();
const express = require('express');
const { ApolloServer, gql } = require('apollo-server-express');
const { Pool } = require('pg');
const cors = require('cors');
const axios = require('axios');

const pool = new Pool({
    connectionString: process.env.SUPABASE_DB_URL,
});

// GraphQL Schema
const typeDefs = gql`
    type Part {
        id: ID!
        name: String!
        description: String
    }

    type Message {
        id: ID!
        user_id: String!
        text: String!
        part_id: ID
        suggested_part: String
    }

    type Query {
        parts: [Part]
        messages: [Message]
    }

    type Mutation {
        addPart(name: String!, description: String): Part
        addMessage(user_id: String!, text: String!): Message
    }
`;

// GraphQL Resolvers
const resolvers = {
    Query: {
        parts: async () => {
            const { rows } = await pool.query(
                'SELECT * FROM parts ORDER BY created_at DESC'
            );
            return rows;
        },
        messages: async () => {
            const { rows } = await pool.query(`
                SELECT messages.*, parts.name AS part_name
                FROM messages
                LEFT JOIN parts ON messages.part_id = parts.id
                ORDER BY messages.created_at DESC
            `);
            return rows;
        },
    },
    Mutation: {
        addPart: async (_, { name, description }) => {
            const { rows } = await pool.query(
                'INSERT INTO parts (name, description) VALUES ($1, $2) RETURNING *',
                [name, description]
            );
            return rows[0];
        },

        addMessage: async (_, { user_id, text }) => {
            const suggestedPart = await analyzeTone(text);

            console.log(suggestedPart);

            const { rows } = await pool.query(
                'INSERT INTO messages (user_id, text, part_id, suggested_part) VALUES ($1, $2, (SELECT id FROM parts WHERE name = $3 LIMIT 1), $3) RETURNING *',
                [user_id, text, suggestedPart]
            );
            return rows[0];
        },
    },
};

const analyzeTone = async (text) => {
    // try {
    // Fetch parts
    const { rows: parts } = await pool.query('SELECT name FROM parts');
    const partNames = parts.map((p) => p.name).join(', ');

    console.log({ partNames, text: 'text' });

    // Fetch past message associations
    const { rows: pastMessages } = await pool.query(
        'SELECT text, suggested_part FROM messages ORDER BY created_at DESC LIMIT 50'
    );
    console.log('made it here');

    // console.log({ pastMessages });
    const messageHistory = pastMessages
        .map((m) => `"${m.text}" → ${m.suggested_part}`)
        .join('\n');

    console.log('making request');
    // Send message + context to AI
    const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
            model: 'gpt-4-turbo',
            messages: [
                {
                    role: 'user',
                    content: `say hello`,
                },
                // { role: 'user', content: text },
            ],
            temperature: 0.5,
        },
        {
            headers: {
                Authorization: process.env.OPEN_AI_TOKEN,
            },
        }
    );
    console.log('done request');
    console.log({ response });
    return response.data.choices[0].message.content.trim();
    // } catch (error) {
    //     console.error('AI Error:', error);
    //     return 'Unknown';
    // }
};

const app = express();
const server = new ApolloServer({ typeDefs, resolvers });
app.use(cors());

server.start().then(() => {
    server.applyMiddleware({ app });
    app.listen({ port: 4000 }, () => {
        console.log(
            `🚀 Server ready at http://localhost:4000${server.graphqlPath}`
        );
    });
});
