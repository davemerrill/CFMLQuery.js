CFMLQuery: Javascript class that manages datasets in CFML's default JSON format

- Converts DATA array to objects with named keys (columns), in place

- Avoids creating two copies of large data

- By default, uses lcased query column names as field names for the data array

- Can use your own field names
	Pass either a list of names, or an array of metadata objects

- Updates COLUMNS array with names used
	Exposes column definitions by field name as a public property

- Optional decorator function can process each data row as it's created
	Use to format data or create calc'd columns

- Easily omit columns you don't need

- Load data as many times as desired without recalculating column infos
	As long as it's in the same format

- Observable

- Generates a compiled a conversion function once columns are defined, for speed

- Standalone, no dependencies