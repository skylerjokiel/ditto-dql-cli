# Ditto DQL Terminal

A simple command-line interface for running DQL queries against a Ditto database with a movie dataset.

> This application is designed for local DQL query execution and **does not enable sync** intentionally.

> To reset the database stop the application and delete the `./ditto` directory from the root.

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Start the terminal:
```bash
npm run dev
```

The terminal will automatically import the movie dataset on first run.

## Basic Commands

### Terminal Commands

- **DQL Query** - Type any DQL query directly and press Enter
- `.help` - Show help message with all available commands
- `.list` - Show all available scenarios with index numbers
- `.run <name|index>` - Run a predefined scenario by name or index number (e.g., `.run count_all` or `.run 1`)
- `.all` - Run all scenarios in sequence with comprehensive summary
- `.bench <query>` - Benchmark a query performance (100 runs with statistics)
- `.exit` - Exit the terminal

### Example DQL Queries

```sql
-- Count all movies
SELECT count(*) FROM movies

-- Find movies by year
SELECT * FROM movies WHERE _id.year = '2001'

-- Search by title
SELECT * FROM movies WHERE CONTAINS(_id.title,'Star')

```

## Movie Document Structure

Each movie in the database has the following structure:

```json
{
  "_id": {
    "id": "573a1390f29313caabcd4135",
    "title": "Blacksmith Scene",
    "year": "1893",
    "type": "movie"
  },
  "plot": "Three men hammer on an anvil...",
  "genres": ["Short"],
  "runtime": 1,
  "cast": ["Charles Kayser", "John Ott"],
  "fullplot": "A stationary camera looks at...",
  "countries": ["USA"],
  "released": "1893-05-09T00:00:00.000Z",
  "directors": ["William K.L. Dickson"],
  "rated": "UNRATED",
  "awards": {
    "wins": 1,
    "nominations": 0,
    "text": "1 win."
  },
  "imdb": {
    "rating": 6.2,
    "votes": 1189,
    "id": 5
  },
  "tomatoes": {
    "viewer": {
      "rating": 3,
      "numReviews": 184,
      "meter": 32
    }
  }
}
```

## Available Scenarios

Run `.list` to see all scenarios with their index numbers. You can run scenarios either by name or index:
- `.run count_all` or `.run 1` - Simple count query
- `.run index_basic` or `.run 2` - Index performance demo
- `.run index_on_id_subfield` or `.run 3` - Indexing on ID subfields

The actual index numbers will depend on the order of scenarios in your `scenarios.json` file.

## Adding New Scenarios

Scenarios are a list of dql commands executed in sequential order.

To add a new scenario, edit `scenarios.json`. Scenarios  and add your queries:

```json
{
  "my_scenario": [
    "SELECT count(*) FROM movies",
    "SELECT * FROM movies WHERE _id.year = '2001'"
  ]
}
```

Stop and restart the app then run it with `.run my_scenario`

## License

MIT