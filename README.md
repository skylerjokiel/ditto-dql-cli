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
- `.bench <query>` - Benchmark a query performance (20 runs with statistics)
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

## Test Harness & Validation

This application functions as a comprehensive test harness for DQL queries with built-in validation:

### Scenario Validation

Scenarios can include automated validation for:
- **Result Count**: Verify queries return the expected number of documents
- **Index Usage**: Automatically run EXPLAIN and validate which index is used
- **Execution Time**: Ensure queries complete within specified time limits

### Scenario Format

Scenarios support both simple strings and validation objects:

```json
{
  "my_scenario": [
    "DROP INDEX IF EXISTS my_index ON movies",
    {
      "query": "SELECT * FROM movies WHERE rated = 'PG'",
      "expectedCount": 1234,
      "expectedIndex": "full_scan",
      "maxExecutionTime": 500
    },
    "CREATE INDEX my_index ON movies (rated)",
    {
      "query": "SELECT * FROM movies WHERE rated = 'PG'", 
      "expectedCount": 1234,
      "expectedIndex": "my_index",
      "maxExecutionTime": 50
    }
  ]
}
```

### Available Scenarios

Run `.list` to see all scenarios with their index numbers. You can run scenarios either by name or index:
- `.run index_basic` or `.run 1` - Basic index performance validation
- `.run index_string_contains` or `.run 2` - Text search with CONTAINS
- `.run validation_test` or `.run 3` - Result count validation examples

Use `.all` to run all scenarios and get a comprehensive test report.

## Performance Benchmarking

Use the `.bench` command to get detailed performance statistics:

```
.bench SELECT * FROM movies WHERE rated = 'APPROVED'
```

This will run the query 20 times and provide:
- Mean, median, min, max execution times
- Standard deviation and percentiles (95th, 99th)
- Queries per second throughput
- Progress tracking during execution

Perfect for comparing indexed vs non-indexed query performance!

## Adding New Scenarios

To add a new scenario, edit `scenarios.json` and add your queries with optional validation:

```json
{
  "my_scenario": [
    "DROP INDEX IF EXISTS my_index ON movies",
    {
      "query": "SELECT * FROM movies WHERE runtime > 120",
      "expectedCount": 8500,
      "expectedIndex": "full_scan",
      "maxExecutionTime": 800
    },
    "CREATE INDEX my_index ON movies (runtime)",
    {
      "query": "SELECT * FROM movies WHERE runtime > 120",
      "expectedCount": 8500,
      "expectedIndex": "my_index", 
      "maxExecutionTime": 100
    }
  ]
}
```

Stop and restart the app then run it with `.run my_scenario`

## License

MIT