/**
* CFMLQuery: Javascript "class" that manages datasets in CFML's default JSON format
*	- converts DATA array to objects with named keys (columns), in place, to avoid creating two copies of large data
*	- by default, uses lcased column names from the query as the field names for the data array
*	- can use your own field names, by passing either a list of names, or an array of metadata objects
*	- updates COLUMNS array with names used, and exposes column definitions by field name as a public property
*	- optional decorator function can process each data row as it's created; use to format data or create calc'd columns
*	- easily omit columns you don't need
*	- load data as many times as desired without recalculating column infos, as long as it's in the same format
*	- observable
*	- generates a compiled a conversion function once columns are defined, for speed
*	- standalone, no dependencies
*
* @param options optional configuration object
*		all options are optional
*		@options.dataColumnList string, default null, alternative to options.metadata
*			comma-delimited list of column names to use instead of what's in query.COLUMNS
*			MUST exactly match the order and number of columns in query.COLUMNS if passed, and what's passed to load()
*		@options.metadata array default null, alternative to options.dataColumnList
*			array of column definitions, like what's returned by CFML's getMetadata(query) function
*			each array item must contain the following fields: Name or name, TypeName or typeName
*				isCaseSensitive is ignored if present
*				typeName isn't used by CFMLQuery, but it's available to calling code in the colInfo public property
*			MUST exactly match the order and number of columns in query.COLUMNS if passed, and what's passed to load()
*
*		if neither dataColumnList nor metadata are passed, lowercased versions of query.COLUMNS are used, with no type
*
*		@options.activeColumnList string, default null
*			comma-delimited list of columns to include in data; others are ignored
*		@options.rowDecorator function default null
*			function that will be called during the building of each row
*			it will be called like this:
*				rowDecorator(rowData, rowIndex)
*			it should alter the passed row object directly, modifying existing fields or adding new ones
*			it should NOT return a new object, creating an unused object in memory; its return value is ignored
*		@options.observers array, default []
*			array of observer objects or functions that should be called when the dataset has updated
*				observers can also be added with the addObserver method of the dataset, and removed with removeObserver
*			observer types:
*				if an observer is a function, it will be called directly
*				if it's an object with a method matching eventName, that method will be called
*			observers are called like this: (the argument names are up to you; they're defined in your observer function)
*				myObserver(eventName, CFMLQueryObject)
*			for example, CFMLQueryObject.DATA is the data array, which is what observers most commonly would access
*				CFMLQueryObject.COLUMNS, .colInfo, and .activeColInfo may also be useful
*
*	@param query optional structure in the default CFML serializeJSON format
*		can also be passed to the load() method, rather than the constructor
*		@query.COLUMNS array of column names, in the order that they appear in the data
*		@query.DATA array of data row arrays, with values for each column, in query.COLUMNS order
*
*	@properties
*		this object exposes a number of public properties, ALL OF WHICH SHOULD BE TREATED AS READ-ONLY (use the API):
*		@DATA: processed array of data objects, each with the spec'd keys and the values from that row
*		@COLUMNS: processed array of column names, in the order they appeared in the passed query
*		@colInfo: object keyed by the spec'd names, containing all the info we have about that column
*			it will always have name and index fields, and will have typeName if metadata containing that info was passed
*				index is the position of that column in the incoming data as serialized by the CFML engine
*			includes all columns, including ones not in DATA because a passed activeColumnList suppressed them
*		@activeColInfo: copy of colInfo, but excluding suppressed by a passed activeColumnList
*		@options: structure with the currently configured options
*
*	@API // TODO: document api methods
*		constructor // returns this
*		setOptions // returns this
*		defineColumns // returns this; TODO: make defineColumns private? private prefix? clear data if it's called?
*		load // returns this
*		updateRow(rowID, valuesObj) // TODO: write updateRow
*		updateMultiple(criteriaObj, valuesObj, callback) // TODO: write updateRow
*		notifyObservers
*		addObserver
*		removeObserver
*		enableNotifications(enable) // TODO: write enableNotifications
*
*	NOTE: this tool processes only the passed query object, it doesn't recurse
*		for an object with multiple queries, or query data with nested query objects, you must process each one explicitly
*
*		TODO: rename notifications as publish/(un)subscribe/subscribers/etc terminology?
*		TODO: change public DATA and COLUMN properties to lowercase?
**/
var CFMLQuery = function(options, query)
{
	"use strict";
	this.COLUMNS = null;
		this.DATA = null;
		this.colInfo = null;
		this.activeColInfo = null;
		this.rowBuilder = null;

	this.options =
	{
		dataColumnList: null,
		metadata: null,
		activeColumnList: null,
		rowDecorator: null,
		observers: []
	};
	this.setOptions(options);

	if (query)
		this.load(query);

	return this;
};


CFMLQuery.prototype.setOptions = function(options)
{
	"use strict";
	var fld;
	for (fld in options)
	{
		if (options.hasOwnProperty(fld))
			this.options[fld] = options[fld];
	}
	this.options.activeColumnList = this.options.activeColumnList ? this.options.activeColumnList.split(',') : '';

	return this;
};


CFMLQuery.prototype.load = function(query)
{
	"use strict";
	var count, i;

	if (!this.colInfo)
		this.defineColumns(query);

	this.DATA = query.DATA;
	count = this.DATA.length;
	for (i = 0; i < count; i++)
		this.DATA[i] = this.rowBuilder(this.DATA[i], i, this.options.rowDecorator);

	this.notifyObservers('load');

	return this;
};


CFMLQuery.prototype.defineColumns = function(query)
{
	"use strict";
	var
		colInfo = {},
		activeColInfo = {},
		functionJS = [],
		functionArgs = 'rowData,rowIndex',
		colCount = query.COLUMNS.length,
		colArray, col, i;

	if (this.options.metadata)
	{
		colArray = this.options.metadata;
		if (colCount > 0 && colArray.length !== colCount)
			throw('CFMLQuery.defineColumns was passed metadata with the wrong number of columns: Metadata: ' + colArray.length + ' Query: ' + colCount);
		for (i = 0; i < colCount; i++)
		{
			col = colInfo[colArray[i].Name] || colInfo[colArray[i].name]; // railo uses initial lowercase
			defineColumn(this.options.activeColumnList, colInfo, col, i, colArray[i].TypeName || colArray[i].typeName);
		}
	}
	else
	{
		colArray = this.options.dataColumnList ? this.options.dataColumnList.split(',') : query.COLUMNS;
		if (colArray.length !== colCount)
			throw('CFMLQuery.defineColumns was passed a dataColumnList with the wrong number of columns: List: ' + colArray.length + ' Query: ' + colCount);
		for (i = 0; i < colCount; i++)
		{
			col = this.options.dataColumnList ? colArray[i] : colArray[i].toLowerCase();
			defineColumn(this.options.activeColumnList, colInfo, col, i);
		}
	}

	// TODO: add row index to each row? with what name? configurable?
	functionJS = 'var d = {};\n' + functionJS.join(',\n') + ';\n';
	if (this.options.rowDecorator)
	{
		functionJS += 'rowDecorator(d, rowIndex);';
		functionArgs += ',rowDecorator';
	}
	functionJS += 'return d;'; // yes, it was just an array (~_~)

	this.rowBuilder = new Function(functionArgs, functionJS);
	this.COLUMNS = query.COLUMNS;
	this.DATA = [];
	this.colInfo = colInfo;
	this.activeColInfo = activeColInfo;

	return this;


	function defineColumn(activeColumnList, colInfo, col, index, typeName)
	{
		query.COLUMNS[index] = col;
		colInfo[col] = {index: index, name: col};
		if (typeName)
			colInfo[col].typeName = typeName;
		if (activeColumnList && activeColumnList.indexOf(col) === -1)
			return; // don't include in activeColInfo or rowBuilder function
		activeColInfo[col] = colInfo[col];
		functionJS.push("d['" + col + "'] = rowData[" + index + "]");
	}
};


CFMLQuery.prototype.notifyObservers = function(eventName)
{
	"use strict";
	var observers = this.options.observers,
		count = observers.length,
		i, obs;
	for (i = 0; i < count; i++)
	{
		obs = observers[i];
		if (typeof obs === 'function')
			obs(eventName, this);
		else if (typeof obs[eventName] === 'function')
			obs[eventName](this);
	}
};

CFMLQuery.prototype.addObserver = function(observerFunction)
{
	"use strict";
	var observers = this.options.observers,
		count = observers.length,
		i;
	for (i = 0; i < count; i++)
	{
		if (observers[i] === observerFunction)
			return;
	}
	observers.push(observerFunction);
};

CFMLQuery.prototype.removeObserver = function(observerFunction)
{
	"use strict";
	var observers = this.options.observers,
		count = observers.length,
		i;
	for (i = 0; i < count; i++)
	{
		if (observers[i] === observerFunction)
		{
			observers.splice(i, 1);
			return;
		}
	}
};